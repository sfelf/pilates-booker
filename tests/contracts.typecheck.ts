import type {
  BookingPolicy,
  BookingRequest,
  BookingResult
} from "../src/contracts.js";

const requestId = "00000000-0000-4000-8000-000000000001";

const observedClass = {
  name: "Example Movement Class (Level 2)",
  instructor: "Synthetic Instructor",
  date: "2030-01-16",
  start_time: "10:30",
  end_time: "11:30",
  timezone: "America/Los_Angeles"
} as const;

const approvedPackages = [
  { name: "Synthetic Priority Package", remaining: 3, approved: true },
  { name: "Synthetic Other Package", remaining: 2, approved: false }
] as const;

const booked: BookingResult = {
  schema_version: 1,
  request_id: requestId,
  outcome: "BOOKED",
  exit_code: 0,
  action_submitted: true,
  confirmation_verified: true,
  observed_class: observedClass,
  package_selected: "Synthetic Priority Package",
  packages_before: [
    { name: "Synthetic Priority Package", remaining: 3, approved: true },
    { name: "Synthetic Other Package", remaining: 2, approved: false }
  ],
  safety_checks: {
    exact_class_match: true,
    approved_package_verified: true,
    no_charge: true,
    cancellation_policy_accepted: true
  },
  details: "Booking confirmed."
};

const waitlisted: BookingResult = {
  schema_version: 1,
  request_id: requestId,
  outcome: "WAITLISTED",
  exit_code: 0,
  action_submitted: true,
  confirmation_verified: true,
  observed_class: observedClass,
  package_selected: "Synthetic Priority Package",
  packages_before: approvedPackages,
  safety_checks: {
    exact_class_match: true,
    approved_package_verified: true,
    no_charge: true,
    cancellation_policy_accepted: true
  },
  details: "Waitlist enrollment confirmed."
};

const alreadyBooked: BookingResult = {
  schema_version: 1,
  request_id: requestId,
  outcome: "ALREADY_BOOKED",
  exit_code: 0,
  action_submitted: false,
  confirmation_verified: true,
  observed_class: observedClass,
  google_calendar_url: "https://app.arketa.co/api/calendar/google?classId=FAKE",
  safety_checks: {
    exact_class_match: true,
    approved_package_verified: false,
    no_charge: true,
    cancellation_policy_accepted: false
  },
  details: "Existing booking confirmed."
};

const alreadyWaitlisted: BookingResult = {
  schema_version: 1,
  request_id: requestId,
  outcome: "ALREADY_WAITLISTED",
  exit_code: 0,
  action_submitted: false,
  confirmation_verified: true,
  observed_class: observedClass,
  safety_checks: {
    exact_class_match: true,
    approved_package_verified: false,
    no_charge: true,
    cancellation_policy_accepted: false
  },
  details: "Existing waitlist enrollment confirmed."
};

const actionableDryRun: BookingResult = {
  schema_version: 1,
  request_id: requestId,
  outcome: "DRY_RUN",
  exit_code: 0,
  action_submitted: false,
  confirmation_verified: false,
  availability: "BOOKING_AVAILABLE",
  observed_class: observedClass,
  package_selected: "Synthetic Priority Package",
  packages_before: approvedPackages,
  safety_checks: {
    exact_class_match: true,
    approved_package_verified: true,
    no_charge: false,
    cancellation_policy_accepted: false
  },
  details: "Dry run found a bookable class."
};

const existingEnrollmentDryRun: BookingResult = {
  schema_version: 1,
  request_id: requestId,
  outcome: "DRY_RUN",
  exit_code: 0,
  action_submitted: false,
  confirmation_verified: true,
  availability: "ALREADY_BOOKED",
  observed_class: observedClass,
  google_calendar_url: "https://app.arketa.co/api/calendar/google?classId=FAKE",
  safety_checks: {
    exact_class_match: true,
    approved_package_verified: false,
    no_charge: true,
    cancellation_policy_accepted: false
  },
  details: "Dry run found an existing booking."
};

const safeStopWithoutPackageEvidence: BookingResult = {
  schema_version: 1,
  request_id: requestId,
  outcome: "SAFE_STOP",
  exit_code: 20,
  action_submitted: false,
  confirmation_verified: false,
  observed_class: observedClass,
  safety_checks: {
    exact_class_match: true,
    approved_package_verified: false,
    no_charge: true,
    cancellation_policy_accepted: false
  },
  details: "Stopped before submission."
};

const safeStopWithPackageEvidence: BookingResult = {
  ...safeStopWithoutPackageEvidence,
  package_selected: null,
  packages_before: approvedPackages
};

const technicalFailure: BookingResult = {
  schema_version: 1,
  request_id: requestId,
  outcome: "TECHNICAL_FAILURE",
  exit_code: 30,
  action_submitted: false,
  confirmation_verified: false,
  safety_checks: {
    exact_class_match: false,
    approved_package_verified: false,
    no_charge: false,
    cancellation_policy_accepted: false
  },
  details: "Technical failure."
};

const confirmationUncertain: BookingResult = {
  schema_version: 1,
  request_id: requestId,
  outcome: "CONFIRMATION_UNCERTAIN",
  exit_code: 40,
  action_submitted: true,
  confirmation_verified: false,
  safety_checks: {
    exact_class_match: true,
    approved_package_verified: true,
    no_charge: true,
    cancellation_policy_accepted: true
  },
  details: "Booking confirmation is uncertain."
};

const bookedWithCalendarUrl: BookingResult = {
  ...booked,
  google_calendar_url: "https://app.arketa.co/api/calendar/google?classId=FAKE"
};

// @ts-expect-error package_used is excluded from schema version 1 results.
const removedPackageUsed: BookingResult = { ...booked, package_used: "Legacy" };
const removedSubmissionAttempts: BookingResult = {
  ...booked,
  // @ts-expect-error submission_attempts is excluded from schema version 1 results.
  submission_attempts: 1
};
// @ts-expect-error retryable is excluded from schema version 1 results.
const removedRetryable: BookingResult = { ...booked, retryable: false };
const removedFailureStage: BookingResult = {
  ...technicalFailure,
  // @ts-expect-error failure_stage is excluded from schema version 1 results.
  failure_stage: "legacy"
};
const removedPaymentState: BookingResult = {
  ...technicalFailure,
  // @ts-expect-error current_payment_state is excluded from schema version 1 results.
  current_payment_state: "legacy"
};
// @ts-expect-error Package selection cannot appear without package balances.
const unpairedSelectedPackage: BookingResult = {
  schema_version: 1,
  request_id: requestId,
  outcome: "SAFE_STOP",
  exit_code: 20,
  action_submitted: false,
  confirmation_verified: false,
  safety_checks: {
    exact_class_match: true,
    approved_package_verified: false,
    no_charge: true,
    cancellation_policy_accepted: false
  },
  details: "Stopped before submission.",
  package_selected: null
};
// @ts-expect-error Package balances cannot appear without package selection.
const unpairedPackageBalances: BookingResult = {
  schema_version: 1,
  request_id: requestId,
  outcome: "SAFE_STOP",
  exit_code: 20,
  action_submitted: false,
  confirmation_verified: false,
  safety_checks: {
    exact_class_match: true,
    approved_package_verified: false,
    no_charge: true,
    cancellation_policy_accepted: false
  },
  details: "Stopped before submission.",
  packages_before: approvedPackages
};
// @ts-expect-error Successful actionable outcomes require a non-null selected package.
const bookedWithoutSelectedPackage: BookingResult = {
  ...booked,
  package_selected: null
};
// @ts-expect-error WAITLISTED outcomes cannot include a calendar URL.
const waitlistedWithCalendarUrl: BookingResult = {
  ...waitlisted,
  google_calendar_url: "https://app.arketa.co/api/calendar/google?classId=FAKE"
};
// @ts-expect-error Existing enrollment outcomes cannot include package evidence.
const existingEnrollmentWithPackageEvidence: BookingResult = {
  ...alreadyBooked,
  package_selected: "Synthetic Priority Package",
  packages_before: approvedPackages
};

const validRequest: BookingRequest = {
  schema_version: 1,
  request_id: requestId,
  booking_url:
    "https://app.arketa.co/iframe/example/calendar/checkout/FAKE_CHECKOUT_ID",
  expected_class: {
    name: "Example Movement Class (Level 2)",
    date: "2030-01-16",
    start_time: "10:30",
    timezone: "America/Los_Angeles"
  },
  reserve_for: "myself",
  permitted_actions: ["book"],
  policy_version: "2030-01-01",
  allow_monetary_charge: false,
  dry_run: false
};

const validPolicy: BookingPolicy = {
  schema_version: 1,
  policy_version: "2030-01-01",
  allowed_packages: ["Synthetic Priority Package"]
};

void booked;
void waitlisted;
void alreadyBooked;
void alreadyWaitlisted;
void actionableDryRun;
void existingEnrollmentDryRun;
void safeStopWithoutPackageEvidence;
void safeStopWithPackageEvidence;
void technicalFailure;
void confirmationUncertain;
void bookedWithCalendarUrl;
void removedPackageUsed;
void removedSubmissionAttempts;
void removedRetryable;
void removedFailureStage;
void removedPaymentState;
void unpairedSelectedPackage;
void unpairedPackageBalances;
void bookedWithoutSelectedPackage;
void waitlistedWithCalendarUrl;
void existingEnrollmentWithPackageEvidence;
void validRequest;
void validPolicy;
