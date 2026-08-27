export type PermittedAction = "book" | "waitlist";

export type PermittedActions =
  | readonly ["book"]
  | readonly ["waitlist"]
  | readonly ["book", "waitlist"]
  | readonly ["waitlist", "book"];

export type ExpectedClass = Readonly<{
  name: string;
  date: string;
  start_time: string;
  timezone: string;
}>;

export type ObservedClass = Readonly<{
  name: string;
  instructor: string;
  date: string;
  start_time: string;
  end_time: string;
  timezone: string;
}>;

export type BookingRequest = Readonly<{
  schema_version: 1;
  request_id: string;
  booking_url: string;
  expected_class: ExpectedClass;
  reserve_for: "myself";
  permitted_actions: PermittedActions;
  policy_version: string;
  allow_monetary_charge: false;
  dry_run: boolean;
}>;

export type BookingPolicy = Readonly<{
  schema_version: 1;
  policy_version: string;
  allowed_packages: readonly [string, ...string[]];
}>;

export type Outcome =
  | "BOOKED"
  | "WAITLISTED"
  | "ALREADY_BOOKED"
  | "ALREADY_WAITLISTED"
  | "SAFE_STOP"
  | "TECHNICAL_FAILURE"
  | "CONFIRMATION_UNCERTAIN";

export type JournalState =
  | "INITIALIZED"
  | "VALIDATED"
  | "READY_TO_SUBMIT"
  | "SUBMITTING"
  | "CONFIRMED";

export type PackageBalance = Readonly<{
  name: string;
  remaining: number;
  approved: boolean;
}>;

export type SafetyChecks = Readonly<{
  exact_class_match: boolean;
  approved_package_verified: boolean;
  no_charge: boolean;
  cancellation_policy_accepted: boolean;
}>;

type BookingResultFields = Readonly<{
  schema_version: 1;
  request_id: string;
  action_submitted: boolean;
  confirmation_verified: boolean;
  retryable: boolean;
  submission_attempts: 0 | 1;
  observed_class?: ObservedClass;
  package_used?: string | null;
  packages_before?: readonly PackageBalance[];
  google_calendar_url?: string;
  safety_checks: SafetyChecks;
  details: string;
}>;

type BookingResultForOutcome<
  TOutcome extends Outcome,
  TExitCode extends 0 | 20 | 30 | 40
> = Readonly<
  BookingResultFields & {
    outcome: TOutcome;
    exit_code: TExitCode;
  }
>;

type ConfirmationUncertainBookingResult = Readonly<
  BookingResultFields & {
    outcome: "CONFIRMATION_UNCERTAIN";
    exit_code: 40;
    action_submitted: true;
    submission_attempts: 1;
    confirmation_verified: false;
    retryable: false;
  }
>;

export type BookingResult =
  | BookingResultForOutcome<
      "BOOKED" | "WAITLISTED" | "ALREADY_BOOKED" | "ALREADY_WAITLISTED",
      0
    >
  | BookingResultForOutcome<"SAFE_STOP", 20>
  | BookingResultForOutcome<"TECHNICAL_FAILURE", 30>
  | ConfirmationUncertainBookingResult;

export type JournalRecord = Readonly<{
  schema_version: 1;
  request_id: string;
  state: JournalState;
}>;
