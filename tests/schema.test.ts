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

const validRequest = {
  schema_version: 1,
  request_id: "00000000-0000-4000-8000-000000000001",
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
};

const validResult = {
  schema_version: 1,
  request_id: "00000000-0000-4000-8000-000000000001",
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
  },
  details: "Synthetic confirmation displayed."
};

const actionableDryRun = {
  schema_version: 1,
  request_id: validRequest.request_id,
  outcome: "DRY_RUN",
  exit_code: 0,
  action_submitted: false,
  confirmation_verified: false,
  retryable: false,
  submission_attempts: 0,
  availability: "BOOKING_AVAILABLE",
  observed_class: {
    name: "Example Movement Class (Level 2)",
    instructor: "Synthetic Instructor",
    date: "2030-01-16",
    start_time: "10:30",
    end_time: "11:30",
    timezone: "America/Los_Angeles"
  },
  package_used: "Synthetic Priority Package",
  packages_before: [
    { name: "Synthetic Priority Package", remaining: 2, approved: true }
  ],
  safety_checks: {
    exact_class_match: true,
    approved_package_verified: true,
    no_charge: false,
    cancellation_policy_accepted: false
  },
  details: "Dry run completed."
};

const existingEnrollmentDryRun = {
  schema_version: 1,
  request_id: validRequest.request_id,
  outcome: "DRY_RUN",
  exit_code: 0,
  action_submitted: false,
  confirmation_verified: true,
  retryable: false,
  submission_attempts: 0,
  availability: "ALREADY_BOOKED",
  observed_class: actionableDryRun.observed_class,
  google_calendar_url: "https://calendar.example.test/event/synthetic",
  safety_checks: {
    exact_class_match: true,
    approved_package_verified: false,
    no_charge: false,
    cancellation_policy_accepted: false
  },
  details: "Dry run completed."
};

describe("schema foundations", () => {
  it("accepts valid synthetic request, policy, result, and journal objects", () => {
    expect(validateRequest(validRequest)).toBe(true);
    expect(
      validatePolicy({
        schema_version: 1,
        policy_version: "2030-01-01",
        allowed_packages: ["Synthetic Priority Package"]
      })
    ).toBe(true);
    expect(validateResult(validResult)).toBe(true);
    expect(
      validateJournal({
        schema_version: 1,
        request_id: "00000000-0000-4000-8000-000000000001",
        state: "READY_TO_SUBMIT"
      })
    ).toBe(true);
  });

  it("rejects unknown fields and unsupported schema versions", () => {
    expect(validateRequest({ ...validRequest, unknown: true })).toBe(false);
    expect(validateRequest({ ...validRequest, schema_version: 2 })).toBe(false);
    expect(
      validatePolicy({
        schema_version: 2,
        policy_version: "2030-01-01",
        allowed_packages: ["Synthetic"]
      })
    ).toBe(false);
  });

  it("rejects partial request and result objects missing required fields", () => {
    const partialRequest: Record<string, unknown> = { ...validRequest };
    const partialResult: Record<string, unknown> = { ...validResult };
    delete partialRequest.dry_run;
    delete partialResult.safety_checks;

    expect(validateRequest(partialRequest)).toBe(false);
    expect(validateResult(partialResult)).toBe(false);
  });

  it("rejects malformed request identifiers and unsafe reservation settings", () => {
    expect(validateRequest({ ...validRequest, request_id: "not-a-uuid" })).toBe(
      false
    );
    expect(
      validateRequest({ ...validRequest, reserve_for: "another_person" })
    ).toBe(false);
    expect(
      validateRequest({ ...validRequest, allow_monetary_charge: true })
    ).toBe(false);
  });

  it("rejects empty and duplicate permitted actions", () => {
    expect(validateRequest({ ...validRequest, permitted_actions: [] })).toBe(
      false
    );
    expect(
      validateRequest({ ...validRequest, permitted_actions: ["book", "book"] })
    ).toBe(false);
  });

  it("rejects result outcomes paired with a different exit state", () => {
    expect(
      validateResult({ ...validResult, outcome: "SAFE_STOP", exit_code: 0 })
    ).toBe(false);
    expect(
      validateResult({
        ...validResult,
        outcome: "CONFIRMATION_UNCERTAIN",
        exit_code: 30
      })
    ).toBe(false);
  });

  it("requires submitted and verified evidence for new successful outcomes", () => {
    expect(validateResult(validResult)).toBe(true);
    expect(validateResult({ ...validResult, action_submitted: false })).toBe(
      false
    );
    expect(validateResult({ ...validResult, submission_attempts: 0 })).toBe(
      false
    );
    expect(
      validateResult({ ...validResult, confirmation_verified: false })
    ).toBe(false);
    expect(validateResult({ ...validResult, retryable: true })).toBe(false);
    expect(
      validateResult({
        ...validResult,
        outcome: "WAITLISTED",
        confirmation_verified: false
      })
    ).toBe(false);
    expect(
      validateResult({
        ...validResult,
        safety_checks: {
          ...validResult.safety_checks,
          approved_package_verified: false
        }
      })
    ).toBe(false);
  });

  it("requires existing-enrollment outcomes to be verified without submission", () => {
    const alreadyBooked = {
      ...validResult,
      outcome: "ALREADY_BOOKED",
      action_submitted: false,
      submission_attempts: 0,
      safety_checks: {
        exact_class_match: true,
        approved_package_verified: false,
        no_charge: true,
        cancellation_policy_accepted: false
      }
    };

    expect(validateResult(alreadyBooked)).toBe(true);
    expect(validateResult({ ...alreadyBooked, action_submitted: true })).toBe(
      false
    );
    expect(
      validateResult({ ...alreadyBooked, confirmation_verified: false })
    ).toBe(false);
  });

  it("accepts canonical actionable and existing-enrollment dry-run results", () => {
    expect(validateResult(actionableDryRun)).toBe(true);
    expect(validateResult(existingEnrollmentDryRun)).toBe(true);
  });

  it("rejects contradictory dry-run result evidence", () => {
    const missingAvailability: Record<string, unknown> = {
      ...actionableDryRun
    };
    delete missingAvailability.availability;

    const missingPackageEvidence: Record<string, unknown> = {
      ...actionableDryRun
    };
    delete missingPackageEvidence.package_used;

    const missingObservedClass: Record<string, unknown> = {
      ...actionableDryRun
    };
    delete missingObservedClass.observed_class;

    const existingEnrollmentMissingObservedClass: Record<string, unknown> = {
      ...existingEnrollmentDryRun
    };
    delete existingEnrollmentMissingObservedClass.observed_class;

    expect(validateResult(missingAvailability)).toBe(false);
    expect(validateResult(missingPackageEvidence)).toBe(false);
    expect(validateResult(missingObservedClass)).toBe(false);
    expect(validateResult(existingEnrollmentMissingObservedClass)).toBe(false);
    expect(validateResult({ ...actionableDryRun, packages_before: [] })).toBe(
      false
    );
    expect(
      validateResult({
        ...actionableDryRun,
        packages_before: [
          {
            name: "Synthetic Priority Package",
            remaining: 2,
            approved: false
          }
        ]
      })
    ).toBe(false);
    expect(
      validateResult({
        ...actionableDryRun,
        packages_before: [
          {
            name: "Synthetic Priority Package",
            remaining: 0,
            approved: true
          }
        ]
      })
    ).toBe(false);
    expect(
      validateResult({
        ...existingEnrollmentDryRun,
        package_used: "Synthetic Priority Package"
      })
    ).toBe(false);
    expect(
      validateResult({ ...actionableDryRun, action_submitted: true })
    ).toBe(false);
    expect(
      validateResult({ ...actionableDryRun, confirmation_verified: true })
    ).toBe(false);
    expect(
      validateResult({
        ...actionableDryRun,
        attendee_name: "Synthetic private attendee"
      })
    ).toBe(false);
    expect(
      validateResult({
        ...actionableDryRun,
        injury_answer: "Synthetic private injury"
      })
    ).toBe(false);
  });

  it("preserves mixed actionable package evidence containing a positive approved package", () => {
    expect(
      validateResult({
        ...actionableDryRun,
        package_used: "⭐ Synthetic Priority Package",
        packages_before: [
          {
            name: "Synthetic Backup Package",
            remaining: 0,
            approved: true
          },
          {
            name: "Synthetic Unapproved Package",
            remaining: 8,
            approved: false
          },
          {
            name: "Synthetic Priority Package ★",
            remaining: 2,
            approved: true
          }
        ]
      })
    ).toBe(true);
  });

  it("limits dry-run calendar URLs to already-booked evidence", () => {
    expect(
      validateResult({
        ...actionableDryRun,
        google_calendar_url: "https://calendar.example.test/event/synthetic"
      })
    ).toBe(false);
    expect(
      validateResult({
        ...existingEnrollmentDryRun,
        availability: "ALREADY_WAITLISTED"
      })
    ).toBe(false);
  });

  it("represents valid structural failure and retryability outcomes", () => {
    expect(
      validateResult({
        ...validResult,
        outcome: "TECHNICAL_FAILURE",
        exit_code: 30,
        action_submitted: false,
        confirmation_verified: false,
        retryable: true,
        submission_attempts: 0
      })
    ).toBe(true);
    expect(
      validateResult({
        ...validResult,
        outcome: "CONFIRMATION_UNCERTAIN",
        exit_code: 40,
        confirmation_verified: false,
        retryable: false,
        action_submitted: true,
        submission_attempts: 1
      })
    ).toBe(true);
  });

  it("requires the exact submitted but unverified confirmation-uncertain state", () => {
    const confirmationUncertain = {
      ...validResult,
      outcome: "CONFIRMATION_UNCERTAIN",
      exit_code: 40,
      action_submitted: true,
      confirmation_verified: false,
      retryable: false,
      submission_attempts: 1
    };

    expect(validateResult(confirmationUncertain)).toBe(true);
    expect(validateResult({ ...confirmationUncertain, exit_code: 30 })).toBe(
      false
    );
    expect(
      validateResult({ ...confirmationUncertain, action_submitted: false })
    ).toBe(false);
    expect(
      validateResult({ ...confirmationUncertain, submission_attempts: 0 })
    ).toBe(false);
    expect(
      validateResult({ ...confirmationUncertain, submission_attempts: 2 })
    ).toBe(false);
    expect(
      validateResult({ ...confirmationUncertain, confirmation_verified: true })
    ).toBe(false);
    expect(validateResult({ ...confirmationUncertain, retryable: true })).toBe(
      false
    );
    expect(
      validateResult({
        ...confirmationUncertain,
        outcome: "TECHNICAL_FAILURE",
        exit_code: 30,
        retryable: true
      })
    ).toBe(false);
  });

  it("rejects unknown result outcomes", () => {
    expect(validateResult({ ...validResult, outcome: "UNKNOWN" })).toBe(false);
  });

  it("accepts only known monotonic journal state names", () => {
    expect(
      validateJournal({
        schema_version: 1,
        request_id: validRequest.request_id,
        state: "INITIALIZED"
      })
    ).toBe(true);
    expect(
      validateJournal({
        schema_version: 1,
        request_id: validRequest.request_id,
        state: "SUBMITTING"
      })
    ).toBe(true);
    expect(
      validateJournal({
        schema_version: 1,
        request_id: validRequest.request_id,
        state: "UNKNOWN"
      })
    ).toBe(false);
  });
});
