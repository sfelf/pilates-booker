import { createRequire } from "node:module";

import { describe, expect, test } from "vitest";

import resultSchema from "../schemas/result.schema.json" with { type: "json" };

const require = createRequire(import.meta.url);
const Ajv = require("ajv").default;
const addFormats = require("ajv-formats").default;
const validate = addFormats(new Ajv({ allErrors: true, strict: true })).compile(
  resultSchema
);

const observedClass = {
  name: "Synthetic Reformer Flow",
  instructor: "Synthetic Instructor",
  date: "2030-01-16",
  start_time: "10:30",
  end_time: "11:30",
  timezone: "America/Los_Angeles"
} as const;

const booked = {
  schema_version: 2,
  outcome: "BOOKED",
  exit_code: 0,
  action_submitted: true,
  confirmation_verified: true,
  observed_class: observedClass,
  package_selected: "Synthetic 10 Class Pack",
  packages_before: [
    { name: "Synthetic 10 Class Pack", remaining: 2, approved: true }
  ],
  safety_checks: {
    approved_package_verified: true,
    no_charge: true,
    cancellation_policy_accepted: true
  },
  details: "Booking confirmed."
} as const;

const withoutPackageEvidence = {
  schema_version: 2,
  action_submitted: false,
  confirmation_verified: true,
  observed_class: observedClass,
  safety_checks: {
    approved_package_verified: false,
    no_charge: true,
    cancellation_policy_accepted: false
  }
} as const;

const canonicalResults = {
  booked,
  waitlisted: {
    ...booked,
    outcome: "WAITLISTED",
    details: "Waitlist confirmed."
  },
  alreadyBooked: {
    ...withoutPackageEvidence,
    outcome: "ALREADY_BOOKED",
    exit_code: 0,
    details: "Existing booking confirmed."
  },
  alreadyWaitlisted: {
    ...withoutPackageEvidence,
    outcome: "ALREADY_WAITLISTED",
    exit_code: 0,
    details: "Existing waitlist confirmed."
  },
  actionableDryRun: {
    ...booked,
    outcome: "DRY_RUN",
    exit_code: 0,
    action_submitted: false,
    confirmation_verified: false,
    availability: "BOOKING_AVAILABLE",
    safety_checks: {
      approved_package_verified: true,
      no_charge: false,
      cancellation_policy_accepted: false
    },
    details: "Dry run completed."
  },
  existingEnrollmentDryRun: {
    ...withoutPackageEvidence,
    outcome: "DRY_RUN",
    exit_code: 0,
    availability: "ALREADY_BOOKED",
    details: "Dry run completed."
  },
  safeStop: {
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
  technicalFailure: {
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
  confirmationUncertain: {
    schema_version: 2,
    outcome: "CONFIRMATION_UNCERTAIN",
    exit_code: 40,
    action_submitted: true,
    confirmation_verified: false,
    safety_checks: {
      approved_package_verified: true,
      no_charge: true,
      cancellation_policy_accepted: true
    },
    details: "Booking confirmation is uncertain."
  }
} as const;

describe("result schema version 2", () => {
  test.each(Object.entries(canonicalResults))(
    "accepts coherent %s evidence",
    (_name, result) => {
      expect(validate(result)).toBe(true);
    }
  );

  test("accepts a coherent booked result", () => {
    expect(validate(booked)).toBe(true);
  });

  test.each([
    ["schema version 1", { ...booked, schema_version: 1 }],
    ["request ID", { ...booked, request_id: crypto.randomUUID() }],
    [
      "exact class check",
      {
        ...booked,
        safety_checks: { ...booked.safety_checks, exact_class_match: true }
      }
    ]
  ])("rejects the removed %s contract", (_name, value) => {
    expect(validate(value)).toBe(false);
  });
});
