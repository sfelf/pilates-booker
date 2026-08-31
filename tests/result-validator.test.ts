import { describe, expect, it } from "vitest";

import type { BookingPolicy, BookingRequest } from "../src/contracts.js";
import {
  validateResult,
  validateResultForRecovery,
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

const policy: BookingPolicy = {
  schema_version: 1,
  policy_version: request.policy_version,
  allowed_packages: ["Synthetic Priority Package"]
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
  package_selected: "Synthetic Priority Package",
  packages_before: [
    { name: "Synthetic Backup Package", remaining: 4, approved: false },
    { name: "Synthetic Priority Package", remaining: 2, approved: true }
  ],
  safety_checks: {
    exact_class_match: true,
    approved_package_verified: true,
    no_charge: false,
    cancellation_policy_accepted: false
  },
  details: "Dry run completed."
} as const;

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

const { google_calendar_url: ignoredCalendarUrl, ...bookedWithoutCalendar } =
  booked;
void ignoredCalendarUrl;
const waitlisted = {
  ...bookedWithoutCalendar,
  outcome: "WAITLISTED",
  details: "Waitlist confirmed."
} as const;

const existingSafetyChecks = {
  exact_class_match: true,
  approved_package_verified: false,
  no_charge: false,
  cancellation_policy_accepted: false
} as const;

const alreadyBooked = {
  schema_version: 1,
  request_id: request.request_id,
  outcome: "ALREADY_BOOKED",
  exit_code: 0,
  action_submitted: false,
  confirmation_verified: true,
  observed_class: actionableDryRun.observed_class,
  safety_checks: existingSafetyChecks,
  details: "Existing booking confirmed."
} as const;

const alreadyWaitlisted = {
  ...alreadyBooked,
  outcome: "ALREADY_WAITLISTED",
  details: "Existing waitlist confirmed."
} as const;

const safeStop = {
  schema_version: 1,
  request_id: request.request_id,
  outcome: "SAFE_STOP",
  exit_code: 20,
  action_submitted: false,
  confirmation_verified: false,
  safety_checks: {
    exact_class_match: false,
    approved_package_verified: false,
    no_charge: false,
    cancellation_policy_accepted: false
  },
  details: "Booking stopped safely."
} as const;

const safeStopWithUnapprovedInventory = {
  ...safeStop,
  package_selected: null,
  packages_before: [
    { name: "Synthetic Unapproved Package", remaining: 2, approved: false }
  ]
} as const;

const safeStopWithApprovedInventory = {
  ...safeStopWithUnapprovedInventory,
  packages_before: [
    { name: "Synthetic Priority Package", remaining: 2, approved: true }
  ]
} as const;

const technicalFailure = {
  ...safeStop,
  outcome: "TECHNICAL_FAILURE",
  exit_code: 30,
  details: "Runtime operation failed."
} as const;

const confirmationUncertain = {
  schema_version: 1,
  request_id: request.request_id,
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
} as const;

describe("validateResult actionable dry-run evidence", () => {
  it("accepts and preserves canonical positive configured-package evidence", () => {
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
              name: "Synthetic Priority Package",
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
  it("accepts canonical package evidence and a checkout-bound booked calendar URL", () => {
    expect(validateResultForRequest(booked, request, policy)).toBe(true);
  });

  it("rejects an otherwise valid result for another request", () => {
    expect(
      validateResultForRequest(
        { ...booked, request_id: "00000000-0000-4000-8000-000000000099" },
        request,
        policy
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
    expect(validateResultForRequest(wrongHost, request, policy)).toBe(false);
  });

  it("requires the request to permit the submitted action", () => {
    expect(
      validateResultForRequest(
        booked,
        {
          ...request,
          permitted_actions: ["waitlist"]
        },
        policy
      )
    ).toBe(false);
  });

  it("accepts a null selection when every package balance is unapproved", () => {
    expect(
      validateResultForRequest(safeStopWithUnapprovedInventory, request, policy)
    ).toBe(true);
  });

  it("rejects a null selection with an approved positive package balance", () => {
    expect(
      validateResultForRequest(safeStopWithApprovedInventory, request, policy)
    ).toBe(false);
  });

  it.each([
    ["BOOKED", booked, request],
    ["WAITLISTED", waitlisted, request],
    ["actionable DRY_RUN", actionableDryRun, { ...request, dry_run: true }]
  ] as const)(
    "rejects self-approved arbitrary package evidence for %s",
    (_outcome, canonicalResult, selectedRequest) => {
      const arbitraryPackage = "Synthetic Arbitrary Package";

      expect(
        validateResultForRequest(
          {
            ...canonicalResult,
            package_selected: arbitraryPackage,
            packages_before: [
              { name: arbitraryPackage, remaining: 2, approved: true }
            ]
          },
          selectedRequest,
          policy
        )
      ).toBe(false);
    }
  );

  it("rejects a policy package falsely marked unapproved", () => {
    expect(
      validateResultForRequest(
        {
          ...safeStopWithUnapprovedInventory,
          packages_before: [
            {
              name: "Synthetic Priority Package",
              remaining: 2,
              approved: false
            }
          ]
        },
        request,
        policy
      )
    ).toBe(false);
  });

  it("rejects a noncanonical selected policy package name", () => {
    expect(
      validateResultForRequest(
        {
          ...booked,
          package_selected: "⭐ Synthetic Priority Package"
        },
        request,
        policy
      )
    ).toBe(false);
  });

  it("rejects a noncanonical approved policy package name", () => {
    expect(
      validateResultForRequest(
        {
          ...booked,
          packages_before: [
            {
              name: "⭐ Synthetic Priority Package",
              remaining: 2,
              approved: true
            }
          ]
        },
        request,
        policy
      )
    ).toBe(false);
  });

  it("rejects a nonnormalized unapproved package name", () => {
    expect(
      validateResultForRequest(
        {
          ...safeStopWithUnapprovedInventory,
          packages_before: [
            {
              name: "⭐ Synthetic Other Package ★",
              remaining: 2,
              approved: false
            }
          ]
        },
        request,
        policy
      )
    ).toBe(false);
  });

  it.each([
    ["BOOKED", booked, false],
    ["WAITLISTED", waitlisted, false],
    ["ALREADY_BOOKED", alreadyBooked, false],
    ["ALREADY_WAITLISTED", alreadyWaitlisted, false],
    ["DRY_RUN", actionableDryRun, true],
    ["SAFE_STOP", safeStop, true],
    ["TECHNICAL_FAILURE", technicalFailure, true],
    ["CONFIRMATION_UNCERTAIN", confirmationUncertain, false]
  ] as const)(
    "validates %s against the dry-run request boundary",
    (_outcome, result, expected) => {
      expect(
        validateResultForRequest(result, { ...request, dry_run: true }, policy)
      ).toBe(expected);
    }
  );
});

describe("validateResultForRecovery", () => {
  it("accepts structurally coherent finalized evidence without a mutable checkout binding", () => {
    expect(validateResultForRecovery(booked, request.request_id)).toBe(true);
  });

  it("accepts finalized null selection evidence when every package balance is unapproved", () => {
    expect(
      validateResultForRecovery(
        safeStopWithUnapprovedInventory,
        request.request_id
      )
    ).toBe(true);
  });

  it("rejects finalized null selection evidence with an approved positive package balance", () => {
    expect(
      validateResultForRecovery(
        safeStopWithApprovedInventory,
        request.request_id
      )
    ).toBe(false);
  });

  it("preserves self-consistent package evidence without a current policy", () => {
    const arbitraryPackage = "Synthetic Former Policy Package";

    expect(
      validateResultForRecovery(
        {
          ...booked,
          package_selected: arbitraryPackage,
          packages_before: [
            { name: arbitraryPackage, remaining: 2, approved: true }
          ]
        },
        request.request_id
      )
    ).toBe(true);
    expect(
      validateResultForRecovery(
        {
          ...safeStopWithUnapprovedInventory,
          packages_before: [
            {
              name: "Synthetic Priority Package",
              remaining: 2,
              approved: false
            }
          ]
        },
        request.request_id
      )
    ).toBe(true);
  });

  it.each([
    "https://evil.example/api/calendar/google?classId=FAKE_CHECKOUT_ID",
    "https://app.arketa.co/api/calendar/google?classId=FAKE_CHECKOUT_ID&view=calendar"
  ])("rejects malformed finalized calendar evidence %s", (calendarUrl) => {
    expect(
      validateResultForRecovery(
        { ...booked, google_calendar_url: calendarUrl },
        request.request_id
      )
    ).toBe(false);
  });

  it.each([
    ["ALREADY_BOOKED", alreadyBooked],
    ["ALREADY_WAITLISTED", alreadyWaitlisted],
    ["CONFIRMATION_UNCERTAIN", confirmationUncertain]
  ] as const)(
    "accepts finalized %s evidence without a current request",
    (_outcome, result) => {
      expect(validateResultForRecovery(result, request.request_id)).toBe(true);
    }
  );
});
