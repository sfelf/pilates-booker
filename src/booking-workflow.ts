import {
  BookingPageClassMismatchError,
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
  choosePackage,
  normalizePackageNameForComparison,
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
        const revalidated = await revalidateAuthorizedBooking(
          context,
          page,
          preparation
        );
        if ("outcome" in revalidated) return revalidated;

        await context.advance("READY_TO_SUBMIT");
        await context.advance("SUBMITTING");
        await page.submit(revalidated.action);
        const confirmation = await page.waitForConfirmation(revalidated.action);
        const outcome = revalidated.action === "book" ? "BOOKED" : "WAITLISTED";
        if (confirmation !== outcome) throw new BookingWorkflowError();
        await context.advance("CONFIRMED");

        return confirmedResult(
          context.request.request_id,
          revalidated,
          outcome
        );
      }
    );
  } catch {
    throw new BookingWorkflowError();
  }
}

async function revalidateAuthorizedBooking(
  context: ExecutionContext,
  page: BookingPage,
  preparation: AuthorizedBooking
): Promise<BookingPreparation> {
  let state: BookingPageState;
  try {
    state = await page.readForSubmission();
  } catch (error) {
    return safeStop(
      context.request.request_id,
      !(error instanceof BookingPageClassMismatchError)
    );
  }
  const exactClassMatch = isExactClassMatch(context, state);
  if (
    !exactClassMatch ||
    !isFullyAuthorized(
      context,
      state,
      preparation.action,
      preparation.selection
    )
  ) {
    return safeStop(context.request.request_id, exactClassMatch);
  }
  return {
    ...preparation,
    observed_class: state.observation.observed_class
  };
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

  const selection = choosePackage(context.policy, initial.packages);
  if (selection === undefined) {
    return safeStop(context.request.request_id, true);
  }

  if (context.request.dry_run) {
    if (!hasUsableDryRunControls(initial, action, selection)) {
      return safeStop(context.request.request_id, true);
    }
    return {
      schema_version: 1,
      request_id: context.request.request_id,
      outcome: "DRY_RUN",
      exit_code: 0,
      action_submitted: false,
      submission_attempts: 0,
      confirmation_verified: false,
      retryable: false,
      availability:
        action === "book" ? "BOOKING_AVAILABLE" : "WAITLIST_AVAILABLE",
      observed_class: initial.observation.observed_class,
      package_used: selection.configuredName,
      packages_before: selection.balances,
      safety_checks: {
        exact_class_match: true,
        approved_package_verified: true,
        no_charge: false,
        cancellation_policy_accepted: false
      },
      details: DETAILS.DRY_RUN
    };
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

  const finalSelection = choosePackage(context.policy, state.packages);
  return (
    finalSelection !== undefined &&
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
    submission_attempts: 0,
    confirmation_verified: true,
    retryable: false,
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
    submission_attempts: 0,
    confirmation_verified: true,
    retryable: false,
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
  exactClassMatch: boolean
): TerminalBookingPreparation {
  return {
    schema_version: 1,
    request_id: requestId,
    outcome: "SAFE_STOP",
    exit_code: 20,
    action_submitted: false,
    submission_attempts: 0,
    confirmation_verified: false,
    retryable: false,
    safety_checks: {
      ...incompleteSafetyChecks,
      exact_class_match: exactClassMatch
    },
    details: DETAILS.SAFE_STOP
  };
}

function confirmedResult(
  requestId: string,
  preparation: AuthorizedBooking,
  outcome: "BOOKED" | "WAITLISTED"
): BookingResult {
  const result: BookingResult = {
    schema_version: 1,
    request_id: requestId,
    outcome,
    exit_code: 0,
    action_submitted: true,
    submission_attempts: 1,
    confirmation_verified: true,
    retryable: false,
    observed_class: preparation.observed_class,
    package_used: preparation.selection.configuredName,
    packages_before: preparation.selection.balances,
    safety_checks: preparation.safety_checks,
    details: outcome === "BOOKED" ? DETAILS.BOOKED : DETAILS.WAITLISTED
  };
  if (!validateResult(result)) throw new BookingWorkflowError();
  return result;
}
