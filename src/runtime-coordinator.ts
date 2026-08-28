import type {
  BookingRequest,
  BookingResult,
  JournalRecord,
  JournalState,
  Outcome
} from "./contracts.js";
import { validateResult } from "./result-validator.js";

export type RuntimeOperations = Readonly<{
  readJournal(): Promise<JournalRecord | undefined>;
  writeJournal(record: JournalRecord): Promise<void>;
  readResult(): Promise<ResultReadStatus>;
  writeResult(result: BookingResult): Promise<void>;
}>;

export type ResultReadStatus =
  | Readonly<{ status: "missing" }>
  | Readonly<{ status: "valid"; result: BookingResult }>
  | Readonly<{ status: "invalid"; inspectionRequestId?: string }>
  | Readonly<{ status: "failure" }>;

export type CoordinatorDecision = Readonly<{
  result: BookingResult;
  publish: boolean;
}>;

export type FinalizedDecision = Readonly<{
  result: BookingResult;
  published: boolean;
}>;

export type RuntimeExecutionContext = Readonly<{
  request: BookingRequest;
  advance(state: Exclude<JournalState, "INITIALIZED">): Promise<void>;
}>;

export type RuntimeExecutor = (
  context: RuntimeExecutionContext
) => Promise<BookingResult>;

const nextStates: Readonly<Partial<Record<JournalState, JournalState>>> = {
  INITIALIZED: "VALIDATED",
  VALIDATED: "READY_TO_SUBMIT",
  READY_TO_SUBMIT: "SUBMITTING",
  SUBMITTING: "CONFIRMED"
};

export class RuntimeCoordinator {
  readonly request: BookingRequest;
  private readonly requestId: string;
  private durableState: JournalState | undefined;

  constructor(
    request: BookingRequest,
    private readonly operations: RuntimeOperations
  ) {
    this.request = request;
    this.requestId = request.request_id;
  }

  async initialize(): Promise<void> {
    if (this.durableState !== undefined) {
      throw new Error("invalid journal transition to INITIALIZED");
    }
    await this.writeState("INITIALIZED");
  }

  async advance(state: Exclude<JournalState, "INITIALIZED">): Promise<void> {
    if (
      this.durableState === undefined ||
      nextStates[this.durableState] !== state
    ) {
      throw new Error(`invalid journal transition to ${state}`);
    }

    await this.writeState(state);
  }

  async recover(): Promise<CoordinatorDecision | undefined> {
    let journal: JournalRecord | undefined;
    try {
      journal = await this.operations.readJournal();
    } catch {
      return this.nonPublishableFailure();
    }

    if (journal === undefined) {
      const resultStatus = await this.readResultSafely();
      return resultStatus.status === "missing"
        ? undefined
        : this.nonPublishableFailure();
    }

    if (journal.request_id !== this.requestId) {
      return this.nonPublishableFailure();
    }
    this.durableState = journal.state;

    const resultStatus = await this.readResultSafely();
    if (resultStatus.status === "missing") {
      return {
        result: classifyFailure(this.requestId, journal.state),
        publish: true
      };
    }

    if (resultStatus.status === "failure") {
      return {
        result: classifyFailure(this.requestId, journal.state),
        publish: false
      };
    }

    if (resultStatus.status === "invalid") {
      const inspectionRequestId = resultStatus.inspectionRequestId;
      return {
        result: classifyFailure(this.requestId, journal.state),
        publish: inspectionRequestId === this.requestId
      };
    }

    if (resultStatus.result.request_id !== this.requestId) {
      return {
        result: classifyFailure(this.requestId, journal.state),
        publish: false
      };
    }

    const safeResult = withFixedDetails(resultStatus.result);
    if (
      resultMatchesDurableState(
        safeResult,
        journal.state,
        this.requestId
      )
    ) {
      return {
        result: safeResult,
        publish: safeResult !== resultStatus.result
      };
    }

    return {
      result: classifyFailure(this.requestId, journal.state),
      publish: true
    };
  }

  async run(execute: RuntimeExecutor): Promise<CoordinatorDecision> {
    try {
      const recovered = await this.recover();
      if (recovered !== undefined) return recovered;

      await this.initialize();
      const result = await execute({
        request: this.request,
        advance: (state) => this.advance(state)
      });
      if (!validateResult(result) || this.durableState === undefined) {
        throw new Error("result contradicts durable journal");
      }
      const safeResult = withFixedDetails(result);
      if (
        !resultMatchesDurableState(
          safeResult,
          this.durableState,
          this.requestId
        )
      ) {
        throw new Error("result contradicts durable journal");
      }
      return { result: safeResult, publish: true };
    } catch {
      return {
        result: classifyFailure(this.requestId, this.durableState),
        publish: this.durableState !== undefined
      };
    }
  }

  async finalize(decision: CoordinatorDecision): Promise<FinalizedDecision> {
    const result = withFixedDetails(decision.result);
    if (!decision.publish) return { result, published: true };
    try {
      await this.operations.writeResult(result);
      return { result, published: true };
    } catch {
      return { result, published: false };
    }
  }

  get lastDurableState(): JournalState | undefined {
    return this.durableState;
  }

  private async writeState(state: JournalState): Promise<void> {
    await this.operations.writeJournal({
      schema_version: 1,
      request_id: this.requestId,
      state
    });
    this.durableState = state;
  }

  private async readResultSafely(): Promise<ResultReadStatus> {
    try {
      return await this.operations.readResult();
    } catch {
      return { status: "failure" };
    }
  }

  private nonPublishableFailure(): CoordinatorDecision {
    return {
      result: classifyFailure(this.requestId, this.durableState),
      publish: false
    };
  }
}

const safetyChecks = {
  exact_class_match: false,
  approved_package_verified: false,
  no_charge: false,
  cancellation_policy_accepted: false
} as const;

const submittedSafetyChecks = {
  exact_class_match: true,
  approved_package_verified: true,
  no_charge: true,
  cancellation_policy_accepted: true
} as const;

const allowedOutcomes: Readonly<Record<JournalState, readonly Outcome[]>> = {
  INITIALIZED: ["TECHNICAL_FAILURE"],
  VALIDATED: [
    "ALREADY_BOOKED",
    "ALREADY_WAITLISTED",
    "SAFE_STOP",
    "TECHNICAL_FAILURE"
  ],
  READY_TO_SUBMIT: ["SAFE_STOP", "TECHNICAL_FAILURE"],
  SUBMITTING: ["CONFIRMATION_UNCERTAIN"],
  CONFIRMED: ["BOOKED", "WAITLISTED", "CONFIRMATION_UNCERTAIN"]
};

const detailsMarkers = {
  BOOKED: "Booking confirmed.",
  WAITLISTED: "Waitlist confirmed.",
  ALREADY_BOOKED: "Existing booking confirmed.",
  ALREADY_WAITLISTED: "Existing waitlist confirmed.",
  SAFE_STOP: "Booking stopped safely.",
  TECHNICAL_FAILURE: "Runtime operation failed.",
  CONFIRMATION_UNCERTAIN: "Booking confirmation is uncertain."
} as const satisfies Readonly<Record<Outcome, string>>;

function withFixedDetails(result: BookingResult): BookingResult {
  const details = detailsMarkers[result.outcome];
  return result.details === details
    ? result
    : ({ ...result, details } as BookingResult);
}

function technicalFailureResult(requestId: string): BookingResult {
  return {
    schema_version: 1,
    request_id: requestId,
    outcome: "TECHNICAL_FAILURE",
    exit_code: 30,
    action_submitted: false,
    confirmation_verified: false,
    retryable: false,
    submission_attempts: 0,
    safety_checks: safetyChecks,
    details: "Runtime operation failed."
  };
}

function confirmationUncertainResult(requestId: string): BookingResult {
  return {
    schema_version: 1,
    request_id: requestId,
    outcome: "CONFIRMATION_UNCERTAIN",
    exit_code: 40,
    action_submitted: true,
    confirmation_verified: false,
    retryable: false,
    submission_attempts: 1,
    safety_checks: submittedSafetyChecks,
    details: "Booking confirmation is uncertain."
  };
}

export const isPostSubmission = (state: JournalState | undefined): boolean =>
  state === "SUBMITTING" || state === "CONFIRMED";

export function classifyFailure(
  requestId: string,
  state: JournalState | undefined
): BookingResult {
  return isPostSubmission(state)
    ? confirmationUncertainResult(requestId)
    : technicalFailureResult(requestId);
}

export function resultMatchesDurableState(
  result: BookingResult,
  state: JournalState,
  requestId: string
): boolean {
  if (
    result.request_id !== requestId ||
    !allowedOutcomes[state].includes(result.outcome) ||
    result.details !== detailsMarkers[result.outcome]
  ) {
    return false;
  }

  const noSubmission =
    !result.action_submitted &&
    result.submission_attempts === 0 &&
    !result.safety_checks.cancellation_policy_accepted;

  switch (result.outcome) {
    case "BOOKED":
    case "WAITLISTED":
      return (
        result.action_submitted &&
        result.submission_attempts === 1 &&
        result.confirmation_verified &&
        result.safety_checks.cancellation_policy_accepted &&
        result.safety_checks.exact_class_match &&
        result.safety_checks.approved_package_verified &&
        result.safety_checks.no_charge
      );
    case "ALREADY_BOOKED":
    case "ALREADY_WAITLISTED":
      return (
        noSubmission &&
        result.confirmation_verified &&
        result.safety_checks.exact_class_match
      );
    case "SAFE_STOP":
    case "TECHNICAL_FAILURE":
      return noSubmission && !result.confirmation_verified;
    case "CONFIRMATION_UNCERTAIN":
      return (
        result.action_submitted &&
        result.submission_attempts === 1 &&
        !result.confirmation_verified &&
        !result.retryable &&
        result.safety_checks.exact_class_match &&
        result.safety_checks.approved_package_verified &&
        result.safety_checks.no_charge &&
        result.safety_checks.cancellation_policy_accepted
      );
  }
}
