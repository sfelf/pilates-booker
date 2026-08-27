import type {
  BookingPolicy,
  BookingRequest,
  BookingResult
} from "../src/contracts.js";

const commonRequestFields = {
  schema_version: 1 as const,
  request_id: "00000000-0000-4000-8000-000000000001",
  booking_url:
    "https://app.arketa.co/iframe/example/calendar/checkout/FAKE_CHECKOUT_ID",
  expected_class: {
    name: "Example Movement Class (Level 2)",
    date: "2030-01-16",
    start_time: "10:30",
    timezone: "America/Los_Angeles"
  },
  reserve_for: "myself" as const,
  policy_version: "2030-01-01",
  allow_monetary_charge: false as const,
  dry_run: false
};

const validOneActionRequest: BookingRequest = {
  ...commonRequestFields,
  permitted_actions: ["book"]
};

const validTwoActionRequest: BookingRequest = {
  ...commonRequestFields,
  permitted_actions: ["waitlist", "book"]
};

const emptyActionRequest: BookingRequest = {
  ...commonRequestFields,
  // @ts-expect-error Booking requests require at least one permitted action.
  permitted_actions: []
};

const validOnePackagePolicy: BookingPolicy = {
  schema_version: 1,
  policy_version: "2030-01-01",
  allowed_packages: ["Synthetic Reserved Package"]
};

const validMultiplePackagePolicy: BookingPolicy = {
  schema_version: 1,
  policy_version: "2030-01-01",
  allowed_packages: [
    "Synthetic Reserved Package",
    "Alternate Synthetic Package"
  ]
};

const emptyPackagePolicy: BookingPolicy = {
  schema_version: 1,
  policy_version: "2030-01-01",
  // @ts-expect-error Booking policies require at least one allowed package.
  allowed_packages: []
};

const commonResultFields = {
  schema_version: 1 as const,
  request_id: "00000000-0000-4000-8000-000000000001",
  action_submitted: false as const,
  confirmation_verified: false as const,
  retryable: false,
  submission_attempts: 0 as const,
  safety_checks: {
    exact_class_match: false,
    approved_package_verified: false,
    no_charge: true,
    cancellation_policy_accepted: false
  },
  details: "Synthetic safe stop."
};

const validSafeStop: BookingResult = {
  ...commonResultFields,
  outcome: "SAFE_STOP",
  exit_code: 20
};

const validTechnicalFailure: BookingResult = {
  ...commonResultFields,
  outcome: "TECHNICAL_FAILURE",
  exit_code: 30,
  retryable: true
};

const validBooked: BookingResult = {
  ...commonResultFields,
  outcome: "BOOKED",
  exit_code: 0,
  action_submitted: true,
  confirmation_verified: true,
  retryable: false,
  submission_attempts: 1,
  safety_checks: {
    exact_class_match: true,
    approved_package_verified: true,
    no_charge: true,
    cancellation_policy_accepted: true
  }
};

// @ts-expect-error BOOKED requires submitted and verified evidence.
const unverifiedBooked: BookingResult = {
  ...commonResultFields,
  outcome: "BOOKED",
  exit_code: 0
};

// @ts-expect-error Submitted but unverified results must be confirmation-uncertain.
const submittedTechnicalFailure: BookingResult = {
  ...commonResultFields,
  outcome: "TECHNICAL_FAILURE",
  exit_code: 30,
  action_submitted: true,
  submission_attempts: 1,
  retryable: true
};

const validConfirmationUncertain: BookingResult = {
  ...commonResultFields,
  outcome: "CONFIRMATION_UNCERTAIN",
  exit_code: 40,
  action_submitted: true,
  confirmation_verified: false,
  retryable: false,
  submission_attempts: 1
};

// @ts-expect-error CONFIRMATION_UNCERTAIN must use exit code 40.
const confirmationUncertainWithWrongExitCode: BookingResult = {
  ...commonResultFields,
  outcome: "CONFIRMATION_UNCERTAIN",
  exit_code: 30,
  action_submitted: true,
  confirmation_verified: false,
  retryable: false,
  submission_attempts: 1
};

// @ts-expect-error CONFIRMATION_UNCERTAIN requires a submitted action.
const confirmationUncertainWithoutSubmission: BookingResult = {
  ...commonResultFields,
  outcome: "CONFIRMATION_UNCERTAIN",
  exit_code: 40,
  action_submitted: false,
  confirmation_verified: false,
  retryable: false,
  submission_attempts: 1
};

// @ts-expect-error CONFIRMATION_UNCERTAIN requires exactly one attempt.
const confirmationUncertainWithNoAttempt: BookingResult = {
  ...commonResultFields,
  outcome: "CONFIRMATION_UNCERTAIN",
  exit_code: 40,
  action_submitted: true,
  confirmation_verified: false,
  retryable: false,
  submission_attempts: 0
};

// @ts-expect-error CONFIRMATION_UNCERTAIN cannot be verified.
const confirmationUncertainWithVerification: BookingResult = {
  ...commonResultFields,
  outcome: "CONFIRMATION_UNCERTAIN",
  exit_code: 40,
  action_submitted: true,
  confirmation_verified: true,
  retryable: false,
  submission_attempts: 1
};

// @ts-expect-error CONFIRMATION_UNCERTAIN cannot be retryable.
const retryableConfirmationUncertain: BookingResult = {
  ...commonResultFields,
  outcome: "CONFIRMATION_UNCERTAIN",
  exit_code: 40,
  action_submitted: true,
  confirmation_verified: false,
  retryable: true,
  submission_attempts: 1
};

// @ts-expect-error SAFE_STOP must use exit code 20.
const impossibleOutcomeExitPair: BookingResult = {
  ...commonResultFields,
  outcome: "SAFE_STOP",
  exit_code: 0
};

void validSafeStop;
void validTechnicalFailure;
void validBooked;
void unverifiedBooked;
void submittedTechnicalFailure;
void validConfirmationUncertain;
void confirmationUncertainWithWrongExitCode;
void confirmationUncertainWithoutSubmission;
void confirmationUncertainWithNoAttempt;
void confirmationUncertainWithVerification;
void retryableConfirmationUncertain;
void impossibleOutcomeExitPair;
void validOneActionRequest;
void validTwoActionRequest;
void emptyActionRequest;
void validOnePackagePolicy;
void validMultiplePackagePolicy;
void emptyPackagePolicy;
