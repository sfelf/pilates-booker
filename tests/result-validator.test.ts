import { expect, it } from "vitest";

import { validateResultForInput } from "../src/result-validator.js";
import type { BookingInput, BookingResult } from "../src/contracts.js";

const input: BookingInput = {
  booking_url:
    "https://app.arketa.co/iframe/synthetic/calendar/checkout/validator",
  allowed_packages: ["Synthetic Pack"],
  permitted_actions: ["book", "waitlist"],
  dry_run: false
};

const booked: BookingResult = {
  schema_version: 2,
  outcome: "BOOKED",
  exit_code: 0,
  action_submitted: true,
  confirmation_verified: true,
  observed_class: {
    name: "Synthetic Class",
    instructor: "Synthetic Instructor",
    date: "2030-01-16",
    start_time: "10:30",
    end_time: "11:20",
    timezone: "America/Los_Angeles"
  },
  package_selected: "Synthetic Pack",
  packages_before: [{ name: "Synthetic Pack", remaining: 2, approved: true }],
  safety_checks: {
    approved_package_verified: true,
    no_charge: true,
    cancellation_policy_accepted: true
  },
  details: "Booking confirmed."
};

const runtimeDetailCases: readonly Readonly<
  [string, BookingResult, BookingInput]
>[] = [
  ["booked", booked, input],
  [
    "waitlisted",
    {
      schema_version: 2,
      outcome: "WAITLISTED",
      exit_code: 0,
      action_submitted: true,
      confirmation_verified: true,
      observed_class: booked.observed_class,
      package_selected: booked.package_selected,
      packages_before: booked.packages_before,
      safety_checks: booked.safety_checks,
      details: "Waitlist confirmed."
    },
    input
  ],
  [
    "already booked",
    {
      schema_version: 2,
      outcome: "ALREADY_BOOKED",
      exit_code: 0,
      action_submitted: false,
      confirmation_verified: true,
      observed_class: booked.observed_class,
      safety_checks: {
        approved_package_verified: false,
        no_charge: false,
        cancellation_policy_accepted: false
      },
      details: "Existing booking confirmed."
    },
    input
  ],
  [
    "already waitlisted",
    {
      schema_version: 2,
      outcome: "ALREADY_WAITLISTED",
      exit_code: 0,
      action_submitted: false,
      confirmation_verified: true,
      observed_class: booked.observed_class,
      safety_checks: {
        approved_package_verified: false,
        no_charge: false,
        cancellation_policy_accepted: false
      },
      details: "Existing waitlist confirmed."
    },
    input
  ],
  [
    "dry run",
    {
      schema_version: 2,
      outcome: "DRY_RUN",
      exit_code: 0,
      action_submitted: false,
      confirmation_verified: false,
      availability: "BOOKING_AVAILABLE",
      observed_class: booked.observed_class,
      package_selected: booked.package_selected,
      packages_before: booked.packages_before,
      safety_checks: {
        approved_package_verified: true,
        no_charge: false,
        cancellation_policy_accepted: false
      },
      details: "Dry run completed."
    },
    { ...input, dry_run: true }
  ],
  [
    "safe stop",
    {
      schema_version: 2,
      outcome: "SAFE_STOP",
      exit_code: 20,
      action_submitted: false,
      confirmation_verified: false,
      safety_checks: {
        approved_package_verified: false,
        no_charge: false,
        cancellation_policy_accepted: false
      },
      details: "Booking stopped safely."
    },
    input
  ],
  [
    "technical failure",
    {
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
    },
    input
  ],
  [
    "confirmation uncertain",
    {
      schema_version: 2,
      outcome: "CONFIRMATION_UNCERTAIN",
      exit_code: 40,
      action_submitted: true,
      confirmation_verified: false,
      safety_checks: booked.safety_checks,
      details: "Booking confirmation is uncertain."
    },
    input
  ]
];

it("binds schema-v2 results to input mode, action, package, and checkout", () => {
  expect(validateResultForInput(booked, input)).toBe(true);
  expect(validateResultForInput(booked, { ...input, dry_run: true })).toBe(
    false
  );
  expect(
    validateResultForInput(booked, {
      ...input,
      allowed_packages: ["Different Pack"]
    })
  ).toBe(false);
  expect(
    validateResultForInput(
      {
        ...booked,
        google_calendar_url:
          "https://app.arketa.co/api/calendar/google?classId=different"
      },
      input
    )
  ).toBe(false);
});

it.each(runtimeDetailCases)(
  "accepts only the fixed details for coherent %s at the runtime boundary",
  (_name, result, selectedInput) => {
    expect(validateResultForInput(result, selectedInput)).toBe(true);
    for (const details of [
      "",
      "Synthetic wrong detail.",
      `${result.details}\nforged`,
      `${result.details}\\u000aforged`
    ]) {
      expect(
        validateResultForInput({ ...result, details }, selectedInput)
      ).toBe(false);
    }
  }
);

it("rejects a waitlist result when input permits booking only", () => {
  const waitlisted: BookingResult = {
    schema_version: 2,
    outcome: "WAITLISTED",
    exit_code: 0,
    action_submitted: true,
    confirmation_verified: true,
    observed_class: booked.observed_class,
    package_selected: "Synthetic Pack",
    packages_before: [{ name: "Synthetic Pack", remaining: 2, approved: true }],
    safety_checks: booked.safety_checks,
    details: "Waitlist confirmed."
  };
  expect(
    validateResultForInput(waitlisted, {
      ...input,
      permitted_actions: ["book"]
    })
  ).toBe(false);
});
