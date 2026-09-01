import type {
  BookingInput,
  BookingResult,
  ExecutionStage,
  PackagePolicy
} from "../src/contracts.js";

const input: BookingInput = {
  booking_url:
    "https://app.arketa.co/iframe/example/calendar/checkout/FAKE_CHECKOUT_ID",
  allowed_packages: ["Synthetic 10 Class Pack", "Synthetic 5 Class Pack"],
  permitted_actions: ["book", "waitlist"],
  dry_run: false
};

const policy: PackagePolicy = { allowed_packages: input.allowed_packages };
const stage: ExecutionStage = "STARTING";

const result: BookingResult = {
  schema_version: 2,
  outcome: "TECHNICAL_FAILURE",
  exit_code: 30,
  action_submitted: false,
  confirmation_verified: false,
  safety_checks: {
    approved_package_verified: false,
    no_charge: false,
    cancellation_policy_accepted: false
  },
  details: "Runtime operation failed."
};

void policy;
void result;
void stage;
