import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

import journalSchema from "../schemas/journal.schema.json" with { type: "json" };
import policySchema from "../schemas/policy.schema.json" with { type: "json" };
import requestSchema from "../schemas/request.schema.json" with { type: "json" };
import resultSchema from "../schemas/result.schema.json" with { type: "json" };

const require = createRequire(import.meta.url);
const Ajv = require("ajv").default;
const addFormats = require("ajv-formats").default;
const ajv = addFormats(new Ajv({ allErrors: true, strict: true }));

const validateRequest = ajv.compile(requestSchema);
const validatePolicy = ajv.compile(policySchema);
const validateResult = ajv.compile(resultSchema);
const validateJournal = ajv.compile(journalSchema);

const requestId = "00000000-0000-4000-8000-000000000001";
const observedClass = {
  name: "Example Movement Class (Level 2)",
  instructor: "Synthetic Instructor",
  date: "2030-01-16",
  start_time: "10:30",
  end_time: "11:30",
  timezone: "America/Los_Angeles"
};
const packagesBefore = [
  { name: "Synthetic Priority Package", remaining: 3, approved: true },
  { name: "Synthetic Other Package", remaining: 2, approved: false }
];
const booked = {
  schema_version: 1,
  request_id: requestId,
  outcome: "BOOKED",
  exit_code: 0,
  action_submitted: true,
  confirmation_verified: true,
  observed_class: observedClass,
  package_selected: "Synthetic Priority Package",
  packages_before: packagesBefore,
  safety_checks: {
    exact_class_match: true,
    approved_package_verified: true,
    no_charge: true,
    cancellation_policy_accepted: true
  },
  details: "Booking confirmed."
};
const waitlisted = {
  ...booked,
  outcome: "WAITLISTED",
  details: "Waitlist enrollment confirmed."
};
const alreadyBooked = {
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
const alreadyWaitlisted = {
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
const actionableDryRun = {
  schema_version: 1,
  request_id: requestId,
  outcome: "DRY_RUN",
  exit_code: 0,
  action_submitted: false,
  confirmation_verified: false,
  availability: "BOOKING_AVAILABLE",
  observed_class: observedClass,
  package_selected: "Synthetic Priority Package",
  packages_before: packagesBefore,
  safety_checks: {
    exact_class_match: true,
    approved_package_verified: true,
    no_charge: false,
    cancellation_policy_accepted: false
  },
  details: "Dry run found a bookable class."
};
const existingEnrollmentDryRun = {
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
const safeStopWithoutPackageEvidence = {
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
const safeStopWithPackageEvidence = {
  ...safeStopWithoutPackageEvidence,
  package_selected: null,
  packages_before: packagesBefore
};
const technicalFailure = {
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
const confirmationUncertain = {
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

describe("schema foundations", () => {
  it("accepts valid synthetic request, policy, and journal objects", () => {
    expect(
      validateRequest({
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
        permitted_actions: ["book", "waitlist"],
        policy_version: "2030-01-01",
        allow_monetary_charge: false,
        dry_run: false
      })
    ).toBe(true);
    expect(
      validatePolicy({
        schema_version: 1,
        policy_version: "2030-01-01",
        allowed_packages: ["Synthetic Priority Package"]
      })
    ).toBe(true);
    expect(
      validateJournal({
        schema_version: 1,
        request_id: requestId,
        state: "READY_TO_SUBMIT"
      })
    ).toBe(true);
  });

  it("accepts every canonical result outcome shape", () => {
    for (const [name, result] of Object.entries({
      booked,
      waitlisted,
      alreadyBooked,
      alreadyWaitlisted,
      actionableDryRun,
      existingEnrollmentDryRun,
      safeStopWithoutPackageEvidence,
      safeStopWithPackageEvidence,
      technicalFailure,
      confirmationUncertain
    })) {
      expect(validateResult(result), name).toBe(true);
    }
    expect(
      validateResult({
        ...booked,
        google_calendar_url:
          "https://app.arketa.co/api/calendar/google?classId=FAKE"
      })
    ).toBe(true);
  });

  it("rejects removed reconstructed result fields", () => {
    for (const field of [
      "package_used",
      "submission_attempts",
      "retryable",
      "failure_stage",
      "current_payment_state"
    ] as const) {
      expect(validateResult({ ...booked, [field]: "removed" })).toBe(false);
    }
  });

  it("rejects non-actionable package evidence combinations", () => {
    expect(validateResult({ ...booked, package_selected: null })).toBe(false);
    const withoutSelectedPackage: Record<string, unknown> = { ...booked };
    delete withoutSelectedPackage.package_selected;
    expect(validateResult(withoutSelectedPackage)).toBe(false);
    expect(validateResult({ ...alreadyBooked, package_selected: null })).toBe(
      false
    );
    expect(
      validateResult({ ...alreadyBooked, packages_before: packagesBefore })
    ).toBe(false);
    expect(
      validateResult({
        ...safeStopWithoutPackageEvidence,
        package_selected: null
      })
    ).toBe(false);
    expect(
      validateResult({
        ...safeStopWithoutPackageEvidence,
        packages_before: packagesBefore
      })
    ).toBe(false);
  });

  it("rejects calendar URLs on waitlist result states", () => {
    const calendarUrl =
      "https://app.arketa.co/api/calendar/google?classId=FAKE";
    expect(
      validateResult({ ...waitlisted, google_calendar_url: calendarUrl })
    ).toBe(false);
    expect(
      validateResult({ ...alreadyWaitlisted, google_calendar_url: calendarUrl })
    ).toBe(false);
    expect(
      validateResult({
        ...existingEnrollmentDryRun,
        availability: "ALREADY_WAITLISTED",
        google_calendar_url: calendarUrl
      })
    ).toBe(false);
  });

  it("rejects malformed required evidence", () => {
    const missingSafetyChecks: Record<string, unknown> = { ...booked };
    delete missingSafetyChecks.safety_checks;
    expect(validateResult({ ...booked, unknown: true })).toBe(false);
    expect(validateResult(missingSafetyChecks)).toBe(false);
    expect(
      validateResult({ ...confirmationUncertain, action_submitted: false })
    ).toBe(false);
    expect(
      validateResult({
        ...confirmationUncertain,
        safety_checks: {
          ...confirmationUncertain.safety_checks,
          no_charge: false
        }
      })
    ).toBe(false);
  });
});
