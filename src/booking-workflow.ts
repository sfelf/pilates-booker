import {
  createBookingBrowser,
  type BookingBrowser,
  type BookingPage,
  type BookingPageState
} from "./booking-page.js";
import { RESULT_DETAILS } from "./contracts.js";
import type {
  BookingInput,
  BookingResult,
  ExecutionStage,
  ObservedClass,
  PermittedAction
} from "./contracts.js";
import type { DebugData } from "./debug-log.js";
import { projectDebugException } from "./debug-exception.js";
import {
  decidePackage,
  normalizePackageNameForComparison,
  type PackageDecision,
  type PackageSelection
} from "./package-selection.js";

export type ExecutionContext = Readonly<{
  input: BookingInput;
  profileDir: string;
  advance(stage: ExecutionStage): Promise<void>;
  log(event: string, data?: DebugData): Promise<void>;
}>;

export type AuthorizedBooking = Readonly<{
  status: "authorized";
  action: PermittedAction;
  observed_class: ObservedClass;
  selection: PackageSelection;
  safety_checks: Readonly<{
    approved_package_verified: true;
    no_charge: true;
    cancellation_policy_accepted: true;
  }>;
}>;

type TerminalBookingPreparation = Extract<
  BookingResult,
  {
    outcome: "DRY_RUN" | "ALREADY_BOOKED" | "ALREADY_WAITLISTED" | "SAFE_STOP";
  }
>;

export type BookingPreparation = TerminalBookingPreparation | AuthorizedBooking;

export class BookingWorkflowError extends Error {
  readonly code = "BOOKING_WORKFLOW_FAILED";

  constructor(cause?: unknown) {
    super("Booking workflow failed.", { cause });
    this.name = "BookingWorkflowError";
  }
}

const incompleteSafetyChecks = {
  approved_package_verified: false,
  no_charge: false,
  cancellation_policy_accepted: false
} as const;

export async function executeBookingWorkflow(
  context: ExecutionContext,
  browser: BookingBrowser = createBookingBrowser()
): Promise<BookingResult> {
  try {
    return await browser(
      context.profileDir,
      context.input.booking_url,
      async (page) => {
        const preparation = await prepareBookingWorkflow(context, page);
        if ("outcome" in preparation) return preparation;

        await context.advance("READY_TO_SUBMIT");
        await context.advance("SUBMITTING");
        await page.submit(preparation.action);
        const confirmation = await page.waitForConfirmation(preparation.action);
        if (confirmation.kind === "UNKNOWN") {
          throw new BookingWorkflowError();
        }
        if (
          (preparation.action === "book" && confirmation.kind !== "BOOKED") ||
          (preparation.action === "waitlist" &&
            confirmation.kind !== "WAITLISTED")
        ) {
          throw new BookingWorkflowError();
        }
        await context.advance("CONFIRMED");

        return confirmedResult(preparation, confirmation);
      }
    );
  } catch (error) {
    throw new BookingWorkflowError(error);
  }
}

export async function prepareBookingWorkflow(
  context: ExecutionContext,
  page: BookingPage
): Promise<BookingPreparation> {
  await context.advance("VALIDATED");

  let initial: BookingPageState;
  try {
    initial = await page.read();
  } catch (error) {
    await logPageFailure(context, error);
    return safeStop();
  }

  if (initial.observation.action === "already_booked") {
    return context.input.dry_run
      ? existingDryRun(context, initial, "ALREADY_BOOKED")
      : existingEnrollment(context, initial, "ALREADY_BOOKED");
  }
  if (initial.observation.action === "already_waitlisted") {
    return context.input.dry_run
      ? existingDryRun(context, initial, "ALREADY_WAITLISTED")
      : existingEnrollment(context, initial, "ALREADY_WAITLISTED");
  }

  const action = initial.observation.action;
  if (
    (action !== "book" && action !== "waitlist") ||
    !context.input.permitted_actions.some(
      (permittedAction) => permittedAction === action
    )
  ) {
    return safeStop();
  }

  const packageDecision = decidePackage(
    { allowed_packages: context.input.allowed_packages },
    initial.packages
  );
  if (packageDecision === undefined) {
    return safeStop();
  }
  const selection = packageDecision.selection;
  if (selection === null) {
    return safeStop(packageDecision);
  }

  if (context.input.dry_run) {
    if (!hasUsableDryRunControls(initial, action, selection)) {
      return safeStop();
    }
    return actionableDryRun(context, initial, action, selection);
  }

  if (!hasUsableInitialControls(initial, selection)) {
    return safeStop();
  }

  let finalState: BookingPageState;
  try {
    if (!initial.myself.selected) {
      await page.selectMyself();
    }
    await page.fillInjuriesIfEmpty("None");
    await page.selectPackage(selection.option.row);
    await page.acceptCancellationPolicy();
    finalState = await page.read();
  } catch (error) {
    await logPageFailure(context, error);
    return safeStop();
  }

  if (!isFullyAuthorized(context, finalState, action, selection)) {
    return safeStop();
  }

  return {
    status: "authorized",
    action,
    observed_class: finalState.observation.observed_class,
    selection,
    safety_checks: {
      approved_package_verified: true,
      no_charge: true,
      cancellation_policy_accepted: true
    }
  };
}

async function logPageFailure(
  context: ExecutionContext,
  error: unknown
): Promise<void> {
  try {
    await context.log("workflow.page_failed", {
      exception: projectDebugException(error)
    });
  } catch {
    // Diagnostic failure must not change the safe-stop decision.
  }
}

function hasUsableDryRunControls(
  state: BookingPageState,
  action: PermittedAction,
  selection: PackageSelection
): boolean {
  return (
    selection.option.control.visibleCount === 1 &&
    selection.option.control.enabled &&
    state.submission[action].visibleCount === 1 &&
    state.submission[action].enabled &&
    state.confirmation.bookedVisibleCount === 0 &&
    state.confirmation.waitlistedVisibleCount === 0
  );
}

function hasUsableInitialControls(
  state: BookingPageState,
  selection: PackageSelection
): boolean {
  return (
    state.myself.visibleCount === 1 &&
    state.myself.enabled &&
    state.injuries.visibleCount === 1 &&
    state.injuries.enabled &&
    selection.option.control.visibleCount === 1 &&
    selection.option.control.enabled &&
    state.cancellation.visibleCount === 1 &&
    state.cancellation.enabled
  );
}

function isFullyAuthorized(
  context: ExecutionContext,
  state: BookingPageState,
  action: PermittedAction,
  initialSelection: PackageSelection
): boolean {
  if (
    state.observation.action !== action ||
    state.myself.visibleCount !== 1 ||
    !state.myself.selected ||
    !state.myself.enabled ||
    state.injuries.visibleCount !== 1 ||
    !state.injuries.enabled ||
    state.injuries.value.trim().length === 0 ||
    state.cancellation.visibleCount !== 1 ||
    !state.cancellation.accepted ||
    !state.cancellation.enabled ||
    state.submission[action].visibleCount !== 1 ||
    !state.submission[action].enabled ||
    state.confirmation.bookedVisibleCount !== 0 ||
    state.confirmation.waitlistedVisibleCount !== 0
  ) {
    return false;
  }

  const finalSelection = decidePackage(
    { allowed_packages: context.input.allowed_packages },
    state.packages
  )?.selection;
  return (
    finalSelection !== undefined &&
    finalSelection !== null &&
    finalSelection.configuredName === initialSelection.configuredName &&
    finalSelection.option.row === initialSelection.option.row &&
    normalizePackageNameForComparison(finalSelection.option.name) ===
      normalizePackageNameForComparison(initialSelection.option.name) &&
    state.selectedPackageRow === finalSelection.option.row &&
    finalSelection.option.control.visibleCount === 1 &&
    finalSelection.option.control.selected &&
    finalSelection.option.control.enabled
  );
}

function existingEnrollment(
  context: ExecutionContext,
  state: BookingPageState,
  outcome: "ALREADY_BOOKED" | "ALREADY_WAITLISTED"
): TerminalBookingPreparation {
  const common = {
    schema_version: 2,
    exit_code: 0,
    action_submitted: false,
    confirmation_verified: true,
    observed_class: state.observation.observed_class,
    safety_checks: incompleteSafetyChecks
  } as const;
  return outcome === "ALREADY_BOOKED"
    ? {
        ...common,
        outcome,
        details: RESULT_DETAILS.ALREADY_BOOKED
      }
    : {
        ...common,
        outcome,
        details: RESULT_DETAILS.ALREADY_WAITLISTED
      };
}

function actionableDryRun(
  context: ExecutionContext,
  state: BookingPageState,
  action: PermittedAction,
  selection: PackageSelection
): TerminalBookingPreparation {
  return {
    schema_version: 2,
    outcome: "DRY_RUN",
    exit_code: 0,
    action_submitted: false,
    confirmation_verified: false,
    availability:
      action === "book" ? "BOOKING_AVAILABLE" : "WAITLIST_AVAILABLE",
    observed_class: state.observation.observed_class,
    ...selectedPackageEvidence(selection),
    safety_checks: {
      approved_package_verified: true,
      no_charge: false,
      cancellation_policy_accepted: false
    },
    details: RESULT_DETAILS.DRY_RUN
  };
}

function existingDryRun(
  context: ExecutionContext,
  state: BookingPageState,
  availability: "ALREADY_BOOKED" | "ALREADY_WAITLISTED"
): TerminalBookingPreparation {
  return {
    schema_version: 2,
    outcome: "DRY_RUN",
    exit_code: 0,
    action_submitted: false,
    confirmation_verified: true,
    availability,
    observed_class: state.observation.observed_class,
    safety_checks: incompleteSafetyChecks,
    details: RESULT_DETAILS.DRY_RUN
  };
}

function safeStop(
  packageDecision?: PackageDecision
): TerminalBookingPreparation {
  return {
    schema_version: 2,
    outcome: "SAFE_STOP",
    exit_code: 20,
    action_submitted: false,
    confirmation_verified: false,
    safety_checks: incompleteSafetyChecks,
    ...(packageDecision?.selection === null
      ? {
          package_selected: null,
          packages_before: packageDecision.balances
        }
      : {}),
    details: RESULT_DETAILS.SAFE_STOP
  };
}

function selectedPackageEvidence(selection: PackageSelection): Readonly<{
  package_selected: string;
  packages_before: PackageSelection["balances"];
}> {
  return {
    package_selected: selection.configuredName,
    packages_before: selection.balances
  };
}

function confirmedResult(
  preparation: AuthorizedBooking,
  confirmation: Extract<
    import("./booking-page.js").BookingConfirmation,
    { kind: "BOOKED" | "WAITLISTED" }
  >
): BookingResult {
  const result: BookingResult =
    confirmation.kind === "BOOKED"
      ? {
          schema_version: 2,
          outcome: "BOOKED",
          exit_code: 0,
          action_submitted: true,
          confirmation_verified: true,
          observed_class: preparation.observed_class,
          ...selectedPackageEvidence(preparation.selection),
          safety_checks: preparation.safety_checks,
          ...(confirmation.googleCalendarUrl === undefined
            ? {}
            : { google_calendar_url: confirmation.googleCalendarUrl }),
          details: RESULT_DETAILS.BOOKED
        }
      : {
          schema_version: 2,
          outcome: "WAITLISTED",
          exit_code: 0,
          action_submitted: true,
          confirmation_verified: true,
          observed_class: preparation.observed_class,
          ...selectedPackageEvidence(preparation.selection),
          safety_checks: preparation.safety_checks,
          details: RESULT_DETAILS.WAITLISTED
        };
  return result;
}
