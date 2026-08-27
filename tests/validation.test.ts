import { describe, expect, it } from "vitest";

import type { BookingPolicy } from "../src/contracts.js";
import { validateRequest } from "../src/validation.js";

const policy: BookingPolicy = {
  schema_version: 1,
  policy_version: "2030-01-01",
  allowed_packages: ["Synthetic Priority Package"]
};

const request = {
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

describe("validateRequest", () => {
  it("returns a schema-valid request with an exact matching policy version", () => {
    expect(validateRequest(request, policy)).toEqual(request);
  });

  it("rejects a policy version mismatch", () => {
    expect(() =>
      validateRequest({ ...request, policy_version: "2030-01-02" }, policy)
    ).toThrow("Invalid booking request.");
  });

  it("rejects an unsafe checkout URL", () => {
    expect(() =>
      validateRequest(
        { ...request, booking_url: `${request.booking_url}?x=1` },
        policy
      )
    ).toThrow("Invalid booking request.");
  });

  it("accepts dry-run only as a non-mutating request marker", () => {
    expect(validateRequest({ ...request, dry_run: true }, policy).dry_run).toBe(
      true
    );
    expect(() =>
      validateRequest(
        { ...request, dry_run: true, accept_cancellation_policy: true },
        policy
      )
    ).toThrow("Invalid booking request.");
    expect(() =>
      validateRequest({ ...request, dry_run: true, submit: true }, policy)
    ).toThrow("Invalid booking request.");
  });

  it.each([
    null,
    {},
    { ...request, permitted_actions: [] },
    { ...request, permitted_actions: ["book", "book"] },
    { ...request, allow_monetary_charge: true }
  ])("rejects malformed request data %#", (value) => {
    expect(() => validateRequest(value, policy)).toThrow(
      "Invalid booking request."
    );
  });
});
