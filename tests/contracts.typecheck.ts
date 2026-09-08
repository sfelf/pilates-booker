import type {
  BookingInput,
  BookingResult,
  DirectBookingInput,
  DiscoveryBookingInput,
  ExecutionStage,
  PackagePolicy
} from "../src/contracts.js";

const checkoutUrl =
  "https://app.arketa.co/iframe/example/calendar/checkout/FAKE_CHECKOUT_ID";
const calendarUrl = "https://app.arketa.co/iframe/example/calendar";

const direct: DirectBookingInput = {
  entry_mode: "checkout",
  booking_url: checkoutUrl,
  allowed_packages: ["Synthetic 10 Class Pack", "Synthetic 5 Class Pack"],
  permitted_actions: ["book", "waitlist"],
  dry_run: false
};

const discovery: DiscoveryBookingInput = {
  entry_mode: "calendar",
  calendar_url: calendarUrl,
  class_name: "Synthetic Reformer",
  class_date: "2026-09-30",
  class_time: "16:30",
  allowed_packages: ["Synthetic Pack"],
  permitted_actions: ["book", "waitlist"],
  dry_run: false
};

const input: BookingInput = direct;

const mixed: BookingInput = {
  entry_mode: "checkout",
  booking_url: checkoutUrl,
  // @ts-expect-error Direct requests cannot include discovery fields.
  calendar_url: calendarUrl,
  class_name: "Synthetic Reformer",
  class_date: "2026-09-30",
  class_time: "16:30",
  allowed_packages: ["Synthetic Pack"],
  permitted_actions: ["book", "waitlist"],
  dry_run: false
};

// @ts-expect-error A discovery request requires all discovery fields.
const partial: BookingInput = {
  entry_mode: "calendar",
  calendar_url: calendarUrl,
  class_name: "Synthetic Reformer",
  class_date: "2026-09-30",
  allowed_packages: ["Synthetic Pack"],
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

void direct;
void discovery;
void mixed;
void partial;
void policy;
void result;
void stage;
