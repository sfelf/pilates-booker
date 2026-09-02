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
