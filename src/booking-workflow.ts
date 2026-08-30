import {
  createBookingBrowser,
  type BookingBrowser,
  type BookingPage,
  type BookingPageState
} from "./booking-page.js";
import type { ExecutionContext } from "./cli.js";
import type {
  BookingResult,
  ObservedClass,
  PermittedAction
} from "./contracts.js";
import {
  decidePackage,
  normalizePackageNameForComparison,
  type PackageDecision,
  type PackageSelection
} from "./package-selection.js";
import { validateResult } from "./result-validator.js";

export type AuthorizedBooking = Readonly<{
  status: "authorized";
  action: PermittedAction;
  observed_class: ObservedClass;
  selection: PackageSelection;
  safety_checks: Readonly<{
    exact_class_match: true;
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

  constructor() {
    super("Booking workflow failed.");
    this.name = "BookingWorkflowError";
  }
}

const DETAILS = {
  BOOKED: "Booking confirmed.",
  WAITLISTED: "Waitlist confirmed.",
  ALREADY_BOOKED: "Existing booking confirmed.",
  ALREADY_WAITLISTED: "Existing waitlist confirmed.",
  DRY_RUN: "Dry run completed.",
  SAFE_STOP: "Booking stopped safely."
} as const;

const incompleteSafetyChecks = {
  exact_class_match: false,
  approved_package_verified: false,
  no_charge: false,
  cancellation_policy_accepted: false
} as const;

export async function executeBookingWorkflow(
  context: ExecutionContext,
  browser: BookingBrowser = createBookingBrowser(context.request.expected_class)
): Promise<BookingResult> {
  try {
    return await browser(
      context.profileDir,
      context.request.booking_url,
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

        return confirmedResult(
          context.request.request_id,
          preparation,
          confirmation
        );
      }
    );
  } catch {
    throw new BookingWorkflowError();
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
  } catch {
    return safeStop(context.request.request_id, false);
  }

  const exactClassMatch = isExactClassMatch(context, initial);
  if (!exactClassMatch) {
    return safeStop(context.request.request_id, false);
  }

  if (initial.observation.action === "already_booked") {
    return context.request.dry_run
      ? existingDryRun(context, initial, "ALREADY_BOOKED")
      : existingEnrollment(context, initial, "ALREADY_BOOKED");
  }
  if (initial.observation.action === "already_waitlisted") {
    return context.request.dry_run
      ? existingDryRun(context, initial, "ALREADY_WAITLISTED")
      : existingEnrollment(context, initial, "ALREADY_WAITLISTED");
  }

  const action = initial.observation.action;
  if (
    (action !== "book" && action !== "waitlist") ||
    !context.request.permitted_actions.some(
      (permittedAction) => permittedAction === action
    )
  ) {
    return safeStop(context.request.request_id, true);
  }

  const packageDecision = decidePackage(context.policy, initial.packages);
  if (packageDecision === undefined) {
    return safeStop(context.request.request_id, true);
  }
  const selection = packageDecision.selection;
  if (selection === null) {
    return safeStop(context.request.request_id, true, packageDecision);
  }

  if (context.request.dry_run) {
    if (!hasUsableDryRunControls(initial, action, selection)) {
      return safeStop(context.request.request_id, true);
    }
    return actionableDryRun(context, initial, action, selection);
  }

  if (!hasUsableInitialControls(initial, selection)) {
    return safeStop(context.request.request_id, true);
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
  } catch {
    return safeStop(context.request.request_id, true);
  }

  const finalClassMatches = isExactClassMatch(context, finalState);
  if (
    !finalClassMatches ||
    !isFullyAuthorized(context, finalState, action, selection)
  ) {
    return safeStop(context.request.request_id, finalClassMatches);
  }

  return {
    status: "authorized",
    action,
    observed_class: finalState.observation.observed_class,
    selection,
    safety_checks: {
      exact_class_match: true,
      approved_package_verified: true,
      no_charge: true,
      cancellation_policy_accepted: true
    }
  };
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
    context.policy,
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

function isExactClassMatch(
  context: ExecutionContext,
  state: BookingPageState
): boolean {
  const expected = context.request.expected_class;
  const observed = state.observation.observed_class;
  return (
    observed.name === expected.name &&
    observed.date === expected.date &&
    observed.start_time === expected.start_time &&
    observed.timezone === expected.timezone
  );
}

function existingEnrollment(
  context: ExecutionContext,
  state: BookingPageState,
  outcome: "ALREADY_BOOKED" | "ALREADY_WAITLISTED"
): TerminalBookingPreparation {
  return {
    schema_version: 1,
    request_id: context.request.request_id,
    outcome,
    exit_code: 0,
    action_submitted: false,
    confirmation_verified: true,
    observed_class: state.observation.observed_class,
    safety_checks: {
      ...incompleteSafetyChecks,
      exact_class_match: true
    },
    details:
      outcome === "ALREADY_BOOKED"
        ? DETAILS.ALREADY_BOOKED
        : DETAILS.ALREADY_WAITLISTED
  };
}

function actionableDryRun(
  context: ExecutionContext,
  state: BookingPageState,
  action: PermittedAction,
  selection: PackageSelection
): TerminalBookingPreparation {
  return {
    schema_version: 1,
    request_id: context.request.request_id,
    outcome: "DRY_RUN",
    exit_code: 0,
    action_submitted: false,
    confirmation_verified: false,
    availability:
      action === "book" ? "BOOKING_AVAILABLE" : "WAITLIST_AVAILABLE",
    observed_class: state.observation.observed_class,
    ...selectedPackageEvidence(selection),
    safety_checks: {
      exact_class_match: true,
      approved_package_verified: true,
      no_charge: false,
      cancellation_policy_accepted: false
    },
    details: DETAILS.DRY_RUN
  };
}

function existingDryRun(
  context: ExecutionContext,
  state: BookingPageState,
  availability: "ALREADY_BOOKED" | "ALREADY_WAITLISTED"
): TerminalBookingPreparation {
  return {
    schema_version: 1,
    request_id: context.request.request_id,
    outcome: "DRY_RUN",
    exit_code: 0,
    action_submitted: false,
    confirmation_verified: true,
    availability,
    observed_class: state.observation.observed_class,
    safety_checks: {
      ...incompleteSafetyChecks,
      exact_class_match: true
    },
    details: DETAILS.DRY_RUN
  };
}

function safeStop(
  requestId: string,
  exactClassMatch: boolean,
  packageDecision?: PackageDecision
): TerminalBookingPreparation {
  return {
    schema_version: 1,
    request_id: requestId,
    outcome: "SAFE_STOP",
    exit_code: 20,
    action_submitted: false,
    confirmation_verified: false,
    safety_checks: {
      ...incompleteSafetyChecks,
      exact_class_match: exactClassMatch
    },
    ...(packageDecision?.selection === null
      ? {
          package_selected: null,
          packages_before: packageDecision.balances
        }
      : {}),
    details: DETAILS.SAFE_STOP
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
  requestId: string,
  preparation: AuthorizedBooking,
  confirmation: Extract<
    import("./booking-page.js").BookingConfirmation,
    { kind: "BOOKED" | "WAITLISTED" }
  >
): BookingResult {
  const result: BookingResult =
    confirmation.kind === "BOOKED"
      ? {
          schema_version: 1,
          request_id: requestId,
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
          details: DETAILS.BOOKED
        }
      : {
          schema_version: 1,
          request_id: requestId,
          outcome: "WAITLISTED",
          exit_code: 0,
          action_submitted: true,
          confirmation_verified: true,
          observed_class: preparation.observed_class,
          ...selectedPackageEvidence(preparation.selection),
          safety_checks: preparation.safety_checks,
          details: DETAILS.WAITLISTED
        };
  if (!validateResult(result)) throw new BookingWorkflowError();
  return result;
}
