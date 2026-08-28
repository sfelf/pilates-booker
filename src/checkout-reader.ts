import type { Page } from "playwright";

import type { RawCheckoutSnapshot } from "./checkout-inspection.js";

export type CheckoutPageReader = Readonly<{
  snapshot(): Promise<RawCheckoutSnapshot>;
}>;

export class CheckoutReadError extends Error {
  readonly code = "CHECKOUT_READ_FAILED";

  constructor() {
    super("Checkout could not be inspected.");
    this.name = "CheckoutReadError";
  }
}

export function createPlaywrightCheckoutReader(page: Page): CheckoutPageReader {
  return {
    snapshot: () =>
      page.locator("body").evaluate((root) => {
        const count = (selector: string): number => {
          const value = root.querySelectorAll(selector).length;
          if (value !== 0 && value !== 1) {
            throw new Error("ambiguous checkout marker");
          }
          return value;
        };
        const read = (container: Element, testId: string): string => {
          const value = container.querySelector(
            `[data-testid="${testId}"]`
          )?.textContent;
          if (value === undefined || value === null) {
            throw new Error("incomplete checkout state");
          }
          return value;
        };

        const classes = Array.from(
          root.querySelectorAll('[data-testid="class"]')
        ).map((element) => ({
          name: read(element, "class-name"),
          instructor: read(element, "instructor"),
          date: read(element, "class-date"),
          start_time: read(element, "start-time"),
          end_time: read(element, "end-time"),
          timezone: read(element, "timezone")
        }));

        const actionSelectors = [
          ["book", '[data-testid="action-book"]'],
          ["waitlist", '[data-testid="action-waitlist"]'],
          ["sold_out", '[data-testid="state-sold-out"]'],
          ["already_booked", '[data-testid="state-already-booked"]'],
          ["already_waitlisted", '[data-testid="state-already-waitlisted"]']
        ] as const;
        const actions = actionSelectors.flatMap(([action, selector]) =>
          count(selector) === 1 ? [action] : []
        );

        const offerings = Array.from(
          root.querySelectorAll('[data-testid="offering"]')
        ).map((element) => {
          const kind = element.getAttribute("data-kind");
          const name = element.textContent ?? "";
          if (kind === "product") return { kind: "product" as const, name };
          const remainingRaw = element.getAttribute("data-remaining");
          const activeRaw = element.getAttribute("data-active");
          if (
            kind !== "class_package" ||
            remainingRaw === null ||
            !/^(?:0|[1-9][0-9]*)$/.test(remainingRaw) ||
            (activeRaw !== "true" && activeRaw !== "false")
          ) {
            throw new Error("invalid checkout offering");
          }
          const remaining = Number(remainingRaw);
          if (!Number.isSafeInteger(remaining)) {
            throw new Error("invalid checkout offering");
          }
          return {
            kind: "class_package" as const,
            name,
            remaining,
            active: activeRaw === "true"
          };
        });

        return {
          authenticated: count('[data-testid="authenticated"]') === 1,
          login_required: count('[data-testid="login-required"]') === 1,
          classes,
          actions,
          offerings
        };
      })
  };
}

export async function readCheckoutSnapshot(
  page: CheckoutPageReader
): Promise<RawCheckoutSnapshot> {
  try {
    return await page.snapshot();
  } catch {
    throw new CheckoutReadError();
  }
}
