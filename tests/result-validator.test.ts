import { describe, expect, it } from "vitest";

import { validateResult } from "../src/result-validator.js";

const actionableDryRun = {
  schema_version: 1,
  request_id: "00000000-0000-4000-8000-000000000001",
  outcome: "DRY_RUN",
  exit_code: 0,
  action_submitted: false,
  confirmation_verified: false,
  retryable: false,
  submission_attempts: 0,
  availability: "BOOKING_AVAILABLE",
  observed_class: {
    name: "Synthetic Reformer Flow",
    instructor: "Synthetic Instructor",
    date: "2030-01-16",
    start_time: "10:30",
    end_time: "11:30",
    timezone: "America/Los_Angeles"
  },
  package_used: "⭐ Synthetic Priority Package",
  packages_before: [
    { name: "Synthetic Backup Package", remaining: 4, approved: false },
    { name: "Synthetic Priority Package ★", remaining: 2, approved: true }
  ],
  safety_checks: {
    exact_class_match: true,
    approved_package_verified: true,
    no_charge: false,
    cancellation_policy_accepted: false
  },
  details: "Dry run completed."
} as const;

describe("validateResult actionable dry-run evidence", () => {
  it("accepts and preserves normalized positive configured-package evidence", () => {
    const before = JSON.stringify(actionableDryRun);

    expect(validateResult(actionableDryRun)).toBe(true);
    expect(JSON.stringify(actionableDryRun)).toBe(before);
  });

  it("rejects positive approved evidence for a different configured package", () => {
    expect(
      validateResult({
        ...actionableDryRun,
        packages_before: [
          { name: "Synthetic Other Package", remaining: 2, approved: true }
        ]
      })
    ).toBe(false);
  });
});
