import { describe, expect, it } from "vitest";

import type { BookingRequest } from "../src/contracts.js";
import {
  CheckoutInspectionError,
  inspectCheckoutSnapshot,
  type RawCheckoutSnapshot
} from "../src/checkout-inspection.js";

const request: BookingRequest = {
  schema_version: 1,
  request_id: "123e4567-e89b-42d3-a456-426614174000",
  booking_url:
    "https://app.arketa.co/iframe/example/calendar/checkout/FAKE_CHECKOUT_ID",
  expected_class: {
    name: "Reformer – Début ✨",
    date: "2026-09-01",
    start_time: "09:30",
    timezone: "America/Los_Angeles"
  },
  reserve_for: "myself",
  permitted_actions: ["book", "waitlist"],
  policy_version: "2026-08-27",
  allow_monetary_charge: false,
  dry_run: true
};

function validSnapshot(
  overrides: Partial<RawCheckoutSnapshot> = {}
): RawCheckoutSnapshot {
  return {
    authenticated: true,
    login_required: false,
    classes: [
      {
        name: "Reformer – Début ✨",
        instructor: "Ana O’Neil",
        date: "2026-09-01",
        start_time: "09:30",
        end_time: "10:20",
        timezone: "America/Los_Angeles"
      }
    ],
    actions: ["book"],
    offerings: [
      {
        kind: "class_package",
        name: "Studio / 10-Class Pack",
        remaining: 3,
        active: true
      }
    ],
    ...overrides
  };
}

describe("inspectCheckoutSnapshot", () => {
  it.each([
    ["book", "book"],
    ["waitlist", "waitlist"],
    ["sold_out", "sold_out"],
    ["already_booked", "already_booked"],
    ["already_waitlisted", "already_waitlisted"]
  ] as const)("preserves a coherent %s action observation", (raw, expected) => {
    const result = inspectCheckoutSnapshot(
      request,
      validSnapshot({ actions: [raw] })
    );

    if (result.status !== "observed") throw new Error("expected observation");
    expect(result.action).toBe(expected);
    expect(result.observed_class.instructor).toBe("Ana O’Neil");
  });

  it("reports login-required without inspecting private class data", () => {
    const result = inspectCheckoutSnapshot(
      request,
      validSnapshot({
        authenticated: false,
        login_required: true,
        classes: [],
        actions: [],
        offerings: []
      })
    );

    expect(result).toEqual({ status: "login_required" });
  });

  it.each([
    ["no authentication marker", { authenticated: false }],
    ["contradictory authentication", { login_required: true }],
    ["missing class", { classes: [] }],
    [
      "duplicate class",
      { classes: [...validSnapshot().classes, ...validSnapshot().classes] }
    ],
    ["missing action", { actions: [] }],
    ["contradictory action", { actions: ["book", "waitlist"] }]
  ] satisfies readonly [string, Partial<RawCheckoutSnapshot>][])(
    "rejects %s with a fixed ambiguous-page error",
    (_name, overrides) => {
      expect(() =>
        inspectCheckoutSnapshot(request, validSnapshot(overrides))
      ).toThrowError(
        expect.objectContaining({ code: "AMBIGUOUS_CHECKOUT_STATE" })
      );
    }
  );

  it.each([
    ["name", { name: "Different class" }],
    ["date", { date: "2026-09-02" }],
    ["start time", { start_time: "10:30" }],
    ["timezone", { timezone: "UTC" }]
  ] as const)(
    "rejects a mismatched class %s without echoing it",
    (_name, field) => {
      const observed = { ...validSnapshot().classes[0]!, ...field };

      try {
        inspectCheckoutSnapshot(
          request,
          validSnapshot({ classes: [observed] })
        );
        throw new Error("expected inspection to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(CheckoutInspectionError);
        expect(error).toMatchObject({ code: "CLASS_MISMATCH" });
        expect(String(error)).not.toContain(String(Object.values(field)[0]));
      }
    }
  );

  it.each([
    ["empty end time", { end_time: "" }],
    ["localized end time", { end_time: "10:20 AM" }],
    ["out-of-range end time", { end_time: "24:00" }],
    ["empty instructor", { instructor: "" }]
  ] as const)("rejects malformed observed class data: %s", (_name, field) => {
    const observed = { ...validSnapshot().classes[0]!, ...field };

    expect(() =>
      inspectCheckoutSnapshot(request, validSnapshot({ classes: [observed] }))
    ).toThrowError(
      expect.objectContaining({ code: "AMBIGUOUS_CHECKOUT_STATE" })
    );
  });

  it("keeps valid catalog text and excludes product and inactive offers before duplicate checks", () => {
    const result = inspectCheckoutSnapshot(
      request,
      validSnapshot({
        offerings: [
          {
            kind: "product",
            name: "Grip Socks — Édition limitée"
          },
          {
            kind: "class_package",
            name: "Studio / 10-Class Pack",
            remaining: 3,
            active: true
          },
          {
            kind: "class_package",
            name: "Intro (zero balance)",
            remaining: 0,
            active: true
          },
          {
            kind: "class_package",
            name: "Studio / 10-Class Pack",
            remaining: 4,
            active: false
          }
        ]
      })
    );

    if (result.status !== "observed") throw new Error("expected observation");
    expect(result.packages).toEqual([
      {
        name: "Studio / 10-Class Pack",
        remaining: 3,
        approved: false
      },
      { name: "Intro (zero balance)", remaining: 0, approved: false }
    ]);
  });

  it.each([
    [
      "empty package name",
      [
        {
          kind: "class_package",
          name: "",
          remaining: 1,
          active: true
        }
      ]
    ],
    [
      "duplicate package names",
      [
        {
          kind: "class_package",
          name: "Pack",
          remaining: 1,
          active: true
        },
        {
          kind: "class_package",
          name: "Pack",
          remaining: 2,
          active: true
        }
      ]
    ],
    [
      "negative balance",
      [
        {
          kind: "class_package",
          name: "Pack",
          remaining: -1,
          active: true
        }
      ]
    ],
    [
      "fractional balance",
      [
        {
          kind: "class_package",
          name: "Pack",
          remaining: 1.5,
          active: true
        }
      ]
    ],
    [
      "unsafe integer balance",
      [
        {
          kind: "class_package",
          name: "Pack",
          remaining: Number.MAX_SAFE_INTEGER + 1,
          active: true
        }
      ]
    ]
  ] satisfies readonly [string, RawCheckoutSnapshot["offerings"]][])(
    "rejects %s",
    (_name, offerings) => {
      expect(() =>
        inspectCheckoutSnapshot(request, validSnapshot({ offerings }))
      ).toThrowError(
        expect.objectContaining({ code: "AMBIGUOUS_CHECKOUT_STATE" })
      );
    }
  );
});
