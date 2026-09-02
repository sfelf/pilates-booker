import { describe, expect, it } from "vitest";

import {
  CheckoutInspectionError,
  inspectCheckoutSnapshot,
  type RawCheckoutSnapshot
} from "../src/checkout-inspection.js";

function snapshot(
  overrides: Partial<RawCheckoutSnapshot> = {}
): RawCheckoutSnapshot {
  return {
    authenticated: true,
    login_required: false,
    classes: [
      {
        name: "Observed Reformer",
        instructor: "Synthetic Instructor",
        date: "2030-01-16",
        start_time: "10:30",
        end_time: "11:20",
        timezone: "America/Los_Angeles"
      }
    ],
    actions: ["book"],
    offerings: [
      {
        kind: "class_package",
        name: "Synthetic Pack",
        remaining: 2,
        active: true
      }
    ],
    ...overrides
  };
}

describe("inspectCheckoutSnapshot", () => {
  it.each([
    "book",
    "waitlist",
    "sold_out",
    "already_booked",
    "already_waitlisted"
  ] as const)(
    "preserves the coherent %s state and observed class",
    (action) => {
      const result = inspectCheckoutSnapshot(snapshot({ actions: [action] }));
      expect(result).toMatchObject({
        status: "observed",
        action,
        observed_class: { name: "Observed Reformer" }
      });
    }
  );

  it("returns login-required only when no private checkout facts are present", () => {
    expect(
      inspectCheckoutSnapshot(
        snapshot({
          authenticated: false,
          login_required: true,
          classes: [],
          actions: [],
          offerings: []
        })
      )
    ).toEqual({ status: "login_required" });
  });

  it.each([
    [
      "contradictory authentication",
      { authenticated: true, login_required: true }
    ],
    ["empty class", { classes: [] }],
    [
      "multiple classes",
      { classes: [...snapshot().classes, ...snapshot().classes] }
    ],
    ["empty action", { actions: [] }],
    ["multiple actions", { actions: ["book", "waitlist"] }],
    [
      "invalid observed time",
      {
        classes: [{ ...snapshot().classes[0]!, start_time: "10:30 AM" }]
      }
    ],
    [
      "duplicate package names",
      {
        offerings: [...snapshot().offerings, ...snapshot().offerings]
      }
    ],
    [
      "unsafe package balance",
      {
        offerings: [
          {
            ...snapshot().offerings[0]!,
            remaining: Number.MAX_SAFE_INTEGER + 1
          }
        ]
      }
    ]
  ] as const)("rejects %s at the observation boundary", (_name, override) => {
    expect(() => inspectCheckoutSnapshot(snapshot(override))).toThrow(
      CheckoutInspectionError
    );
  });
});
