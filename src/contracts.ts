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
  | "DRY_RUN"
  | "SAFE_STOP"
  | "TECHNICAL_FAILURE"
  | "CONFIRMATION_UNCERTAIN";

export type DryRunAvailability =
  | "BOOKING_AVAILABLE"
  | "WAITLIST_AVAILABLE"
  | "ALREADY_BOOKED"
  | "ALREADY_WAITLISTED";

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

export type NonEmptyPackageBalances = readonly [
  PackageBalance,
  ...PackageBalance[]
];

export type SafetyChecks = Readonly<{
  exact_class_match: boolean;
  approved_package_verified: boolean;
  no_charge: boolean;
  cancellation_policy_accepted: boolean;
}>;

type BookingResultFields = Readonly<{
  schema_version: 1;
  request_id: string;
  safety_checks: SafetyChecks;
  details: string;
}>;

type SelectedPackageEvidence = Readonly<{
  package_selected: string;
  packages_before: NonEmptyPackageBalances;
}>;

type OptionalSelectedPackageEvidence =
  | Readonly<{
      package_selected: string | null;
      packages_before: readonly PackageBalance[];
    }>
  | Readonly<{ package_selected?: never; packages_before?: never }>;

type WithoutPackageEvidence = Readonly<{
  package_selected?: never;
  packages_before?: never;
}>;

type ConfirmedBookedResult = Readonly<
  BookingResultFields & {
    outcome: "BOOKED";
    exit_code: 0;
    action_submitted: true;
    confirmation_verified: true;
    observed_class: ObservedClass;
    google_calendar_url?: string;
    safety_checks: Readonly<{
      exact_class_match: true;
      approved_package_verified: true;
      no_charge: true;
      cancellation_policy_accepted: true;
    }>;
  }
>;

type ConfirmedWaitlistedResult = Readonly<
  BookingResultFields &
    SelectedPackageEvidence & {
      outcome: "WAITLISTED";
      exit_code: 0;
      action_submitted: true;
      confirmation_verified: true;
      observed_class: ObservedClass;
      google_calendar_url?: never;
      safety_checks: Readonly<{
        exact_class_match: true;
        approved_package_verified: true;
        no_charge: true;
        cancellation_policy_accepted: true;
      }>;
    }
>;

type ExistingBookedResult = Readonly<
  BookingResultFields & {
    outcome: "ALREADY_BOOKED";
    exit_code: 0;
    action_submitted: false;
    confirmation_verified: true;
    observed_class: ObservedClass;
    google_calendar_url?: string;
    safety_checks: SafetyChecks &
      Readonly<{
        exact_class_match: true;
        cancellation_policy_accepted: false;
      }>;
  }
>;

type ExistingWaitlistedResult = Readonly<
  BookingResultFields &
    WithoutPackageEvidence & {
      outcome: "ALREADY_WAITLISTED";
      exit_code: 0;
      action_submitted: false;
      confirmation_verified: true;
      observed_class: ObservedClass;
      google_calendar_url?: never;
      safety_checks: SafetyChecks &
        Readonly<{
          exact_class_match: true;
          cancellation_policy_accepted: false;
        }>;
    }
>;

type ActionableDryRunBookingResult = Readonly<
  BookingResultFields &
    SelectedPackageEvidence & {
      outcome: "DRY_RUN";
      exit_code: 0;
      action_submitted: false;
      confirmation_verified: false;
      availability: "BOOKING_AVAILABLE" | "WAITLIST_AVAILABLE";
      observed_class: ObservedClass;
      google_calendar_url?: never;
      safety_checks: Readonly<{
        exact_class_match: true;
        approved_package_verified: true;
        no_charge: false;
        cancellation_policy_accepted: false;
      }>;
    }
>;

type ExistingBookedDryRunBookingResult = Readonly<
  BookingResultFields &
    WithoutPackageEvidence & {
      outcome: "DRY_RUN";
      exit_code: 0;
      action_submitted: false;
      confirmation_verified: true;
      availability: "ALREADY_BOOKED";
      observed_class: ObservedClass;
      google_calendar_url?: string;
      safety_checks: SafetyChecks & Readonly<{ exact_class_match: true }>;
    }
>;

type ExistingWaitlistedDryRunBookingResult = Readonly<
  BookingResultFields &
    WithoutPackageEvidence & {
      outcome: "DRY_RUN";
      exit_code: 0;
      action_submitted: false;
      confirmation_verified: true;
      availability: "ALREADY_WAITLISTED";
      observed_class: ObservedClass;
      google_calendar_url?: never;
      safety_checks: SafetyChecks & Readonly<{ exact_class_match: true }>;
    }
>;

type SafeStopBookingResult = Readonly<
  BookingResultFields &
    OptionalSelectedPackageEvidence & {
      outcome: "SAFE_STOP";
      exit_code: 20;
      action_submitted: false;
      confirmation_verified: false;
      observed_class?: ObservedClass;
      google_calendar_url?: never;
    }
>;

type TechnicalFailureBookingResult = Readonly<
  BookingResultFields &
    WithoutPackageEvidence & {
      outcome: "TECHNICAL_FAILURE";
      exit_code: 30;
      action_submitted: false;
      confirmation_verified: false;
      observed_class?: never;
      availability?: never;
      google_calendar_url?: never;
    }
>;

type ConfirmationUncertainBookingResult = Readonly<
  BookingResultFields &
    WithoutPackageEvidence & {
      outcome: "CONFIRMATION_UNCERTAIN";
      exit_code: 40;
      action_submitted: true;
      confirmation_verified: false;
      observed_class?: never;
      availability?: never;
      google_calendar_url?: never;
      safety_checks: Readonly<{
        exact_class_match: true;
        approved_package_verified: true;
        no_charge: true;
        cancellation_policy_accepted: true;
      }>;
    }
>;

export type BookingResult =
  | (ConfirmedBookedResult & SelectedPackageEvidence)
  | ConfirmedWaitlistedResult
  | (ExistingBookedResult & WithoutPackageEvidence)
  | ExistingWaitlistedResult
  | ActionableDryRunBookingResult
  | ExistingBookedDryRunBookingResult
  | ExistingWaitlistedDryRunBookingResult
  | SafeStopBookingResult
  | TechnicalFailureBookingResult
  | ConfirmationUncertainBookingResult;

export type JournalRecord = Readonly<{
  schema_version: 1;
  request_id: string;
  state: JournalState;
}>;

export type CheckoutAction =
  | "book"
  | "waitlist"
  | "sold_out"
  | "already_booked"
  | "already_waitlisted";

export type CheckoutObservation =
  | Readonly<{ status: "login_required" }>
  | Readonly<{
      status: "observed";
      observed_class: ObservedClass;
      action: CheckoutAction;
      packages: readonly PackageBalance[];
    }>;
