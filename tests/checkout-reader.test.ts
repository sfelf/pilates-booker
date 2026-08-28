import { describe, expect, it } from "vitest";

import {
  CheckoutReadError,
  readCheckoutSnapshot
} from "../src/checkout-reader.js";
import {
  bookingFixture,
  FixtureCheckoutPage,
  selectors,
  type CheckoutFixture
} from "./fixtures/checkout.js";

describe("readCheckoutSnapshot", () => {
  it.each([
    [selectors.book, "book"],
    [selectors.waitlist, "waitlist"],
    [selectors.soldOut, "sold_out"],
    [selectors.alreadyBooked, "already_booked"],
    [selectors.alreadyWaitlisted, "already_waitlisted"]
  ] as const)(
    "reads the synthetic %s state without mutation",
    async (selector, action) => {
      const fixture = {
        ...bookingFixture(),
        [selectors.book]: [],
        [selector]: [{}]
      };
      const page = new FixtureCheckoutPage(fixture);

      const snapshot = await readCheckoutSnapshot(page);

      expect(snapshot.actions).toEqual([action]);
      expect(
        page.operations.every((operation) =>
          /^(count|texts|attributes):/.test(operation)
        )
      ).toBe(true);
    }
  );

  it("reads complete class and offering data", async () => {
    const snapshot = await readCheckoutSnapshot(
      new FixtureCheckoutPage(bookingFixture())
    );

    expect(snapshot).toEqual({
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
        },
        {
          kind: "product",
          name: "Grip Socks — Édition limitée",
          remaining: 20,
          active: true
        }
      ]
    });
  });

  it("reads a clean login-required state", async () => {
    const snapshot = await readCheckoutSnapshot(
      new FixtureCheckoutPage({ [selectors.loginRequired]: [{}] })
    );

    expect(snapshot).toEqual({
      authenticated: false,
      login_required: true,
      classes: [],
      actions: [],
      offerings: []
    });
  });

  it.each([
    ["partial class", { ...bookingFixture(), [selectors.endTime]: [] }],
    [
      "misaligned class fields",
      {
        ...bookingFixture(),
        [selectors.className]: [
          ...(bookingFixture()[selectors.className] ?? []),
          { text: "Second" }
        ]
      }
    ],
    [
      "missing offering attribute",
      {
        ...bookingFixture(),
        [selectors.package]: [{ text: "Pack", attributes: {} }]
      }
    ],
    [
      "invalid offering balance",
      {
        ...bookingFixture(),
        [selectors.package]: [
          {
            text: "Pack",
            attributes: {
              "data-kind": "class_package",
              "data-remaining": "many",
              "data-active": "true"
            }
          }
        ]
      }
    ]
  ] satisfies readonly [string, CheckoutFixture][])(
    "rejects %s with a fixed read error",
    async (_name, fixture) => {
      await expect(
        readCheckoutSnapshot(new FixtureCheckoutPage(fixture))
      ).rejects.toEqual(
        expect.objectContaining<Partial<CheckoutReadError>>({
          code: "CHECKOUT_READ_FAILED"
        })
      );
    }
  );
});
