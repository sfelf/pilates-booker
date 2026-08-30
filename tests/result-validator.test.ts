import { describe, expect, it } from "vitest";

import type { BookingRequest } from "../src/contracts.js";
import {
  validateResult,
  validateResultForRequest
} from "../src/result-validator.js";

const request: BookingRequest = {
  schema_version: 1,
  request_id: "00000000-0000-4000-8000-000000000001",
  booking_url:
    "https://app.arketa.co/iframe/example/calendar/checkout/FAKE_CHECKOUT_ID",
  expected_class: {
    name: "Synthetic Reformer Flow",
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

const actionableDryRun = {
  schema_version: 1,
  request_id: "00000000-0000-4000-8000-000000000001",
  outcome: "DRY_RUN",
  exit_code: 0,
  action_submitted: false,
  confirmation_verified: false,
  availability: "BOOKING_AVAILABLE",
  observed_class: {
    name: "Synthetic Reformer Flow",
    instructor: "Synthetic Instructor",
    date: "2030-01-16",
    start_time: "10:30",
    end_time: "11:30",
    timezone: "America/Los_Angeles"
  },
  package_selected: "⭐ Synthetic Priority Package",
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

  it.each([0.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects a non-safe-integer package balance of %s",
    (remaining) => {
      expect(
        validateResult({
          ...actionableDryRun,
          packages_before: [
            {
              name: "Synthetic Priority Package ★",
              remaining,
              approved: true
            }
          ]
        })
      ).toBe(false);
    }
  );

  it("rejects existing-enrollment dry runs without observed class evidence", () => {
    const {
      package_selected: ignoredPackage,
      packages_before: ignoredPackages,
      ...dryRunBase
    } = actionableDryRun;
    void ignoredPackage;
    void ignoredPackages;
    const validExistingEnrollment = {
      ...dryRunBase,
      availability: "ALREADY_BOOKED",
      confirmation_verified: true,
      google_calendar_url: "https://calendar.example.test/event/synthetic",
      safety_checks: {
        ...actionableDryRun.safety_checks,
        approved_package_verified: false
      }
    };
    const { observed_class: ignoredObservedClass, ...withoutObservedClass } =
      validExistingEnrollment;
    void ignoredObservedClass;

    expect(validateResult(validExistingEnrollment)).toBe(true);
    expect(validateResult(withoutObservedClass)).toBe(false);
  });
});

describe("validateResultForRequest", () => {
  const { availability: ignoredAvailability, ...bookedBase } = actionableDryRun;
  void ignoredAvailability;
  const booked = {
    ...bookedBase,
    outcome: "BOOKED",
    action_submitted: true,
    confirmation_verified: true,
    google_calendar_url:
      "https://app.arketa.co/api/calendar/google?classId=FAKE_CHECKOUT_ID",
    safety_checks: {
      exact_class_match: true,
      approved_package_verified: true,
      no_charge: true,
      cancellation_policy_accepted: true
    },
    details: "Booking confirmed."
  } as const;

  it("accepts canonical package evidence and a checkout-bound booked calendar URL", () => {
    expect(validateResultForRequest(booked, request)).toBe(true);
  });

  it("rejects an otherwise valid result for another request", () => {
    expect(
      validateResultForRequest(
        { ...booked, request_id: "00000000-0000-4000-8000-000000000099" },
        request
      )
    ).toBe(false);
  });

  it("rejects a calendar URL not bound to the request checkout", () => {
    const wrongHost = {
      ...booked,
      google_calendar_url:
        "https://evil.example/api/calendar/google?classId=FAKE_CHECKOUT_ID"
    };

    expect(validateResult(wrongHost)).toBe(true);
    expect(validateResultForRequest(wrongHost, request)).toBe(false);
  });

  it("requires the request to permit the submitted action", () => {
    expect(
      validateResultForRequest(booked, {
        ...request,
        permitted_actions: ["waitlist"]
      })
    ).toBe(false);
  });
});
