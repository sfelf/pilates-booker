import type { Page } from "playwright";

import type {
  RawCheckoutSnapshot,
  RawOffering
} from "./checkout-inspection.js";
import type { CheckoutAction, ObservedClass } from "./contracts.js";

const selectors = {
  authenticated: '[data-testid="authenticated"]',
  loginRequired: '[data-testid="login-required"]',
  classContainer: '[data-testid="class"]',
  className: '[data-testid="class-name"]',
  instructor: '[data-testid="instructor"]',
  classDate: '[data-testid="class-date"]',
  startTime: '[data-testid="start-time"]',
  endTime: '[data-testid="end-time"]',
  timezone: '[data-testid="timezone"]',
  package: '[data-testid="offering"]',
  book: '[data-testid="action-book"]',
  waitlist: '[data-testid="action-waitlist"]',
  soldOut: '[data-testid="state-sold-out"]',
  alreadyBooked: '[data-testid="state-already-booked"]',
  alreadyWaitlisted: '[data-testid="state-already-waitlisted"]'
} as const;

export type CheckoutPageReader = Readonly<{
  count(selector: string): Promise<number>;
  texts(selector: string): Promise<readonly string[]>;
  attributes(
    selector: string,
    name: string
  ): Promise<readonly (string | null)[]>;
  elements(
    selector: string,
    attributes: readonly string[]
  ): Promise<readonly CheckoutElement[]>;
  classes(): Promise<readonly ObservedClass[]>;
}>;

export type CheckoutElement = Readonly<{
  text: string;
  attributes: Readonly<Record<string, string | null>>;
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
    count: (selector) => page.locator(selector).count(),
    texts: (selector) => page.locator(selector).allTextContents(),
    attributes: async (selector, name) => {
      const locators = await page.locator(selector).all();
      return Promise.all(locators.map((locator) => locator.getAttribute(name)));
    },
    elements: (selector, attributes) =>
      page.locator(selector).evaluateAll(
        (elements, names) =>
          elements.map((element) => ({
            text: element.textContent ?? "",
            attributes: Object.fromEntries(
              names.map((name) => [name, element.getAttribute(name)])
            )
          })),
        attributes
      ),
    classes: () =>
      page.locator(selectors.classContainer).evaluateAll((elements) =>
        elements.map((element) => {
          const read = (testId: string): string => {
            const value = element.querySelector(
              `[data-testid="${testId}"]`
            )?.textContent;
            if (value === undefined || value === null) {
              throw new Error("incomplete class state");
            }
            return value;
          };
          return {
            name: read("class-name"),
            instructor: read("instructor"),
            date: read("class-date"),
            start_time: read("start-time"),
            end_time: read("end-time"),
            timezone: read("timezone")
          };
        })
      )
  };
}

export async function readCheckoutSnapshot(
  page: CheckoutPageReader
): Promise<RawCheckoutSnapshot> {
  try {
    const [
      authenticatedCount,
      loginRequiredCount,
      classes,
      actions,
      offerings
    ] = await Promise.all([
      checkedCount(page, selectors.authenticated),
      checkedCount(page, selectors.loginRequired),
      readClasses(page),
      readActions(page),
      readOfferings(page)
    ]);

    return {
      authenticated: authenticatedCount === 1,
      login_required: loginRequiredCount === 1,
      classes,
      actions,
      offerings
    };
  } catch {
    throw new CheckoutReadError();
  }
}

async function checkedCount(
  page: CheckoutPageReader,
  selector: string
): Promise<number> {
  const count = await page.count(selector);
  if (count !== 0 && count !== 1) throw new CheckoutReadError();
  return count;
}

async function readClasses(
  page: CheckoutPageReader
): Promise<readonly ObservedClass[]> {
  return page.classes();
}

async function readActions(
  page: CheckoutPageReader
): Promise<readonly CheckoutAction[]> {
  const actionSelectors = [
    ["book", selectors.book],
    ["waitlist", selectors.waitlist],
    ["sold_out", selectors.soldOut],
    ["already_booked", selectors.alreadyBooked],
    ["already_waitlisted", selectors.alreadyWaitlisted]
  ] as const;
  const counts = await Promise.all(
    actionSelectors.map(([, selector]) => checkedCount(page, selector))
  );
  return actionSelectors.flatMap(([action], index) =>
    counts[index] === 1 ? [action] : []
  );
}

async function readOfferings(
  page: CheckoutPageReader
): Promise<readonly RawOffering[]> {
  const elements = await page.elements(selectors.package, [
    "data-kind",
    "data-remaining",
    "data-active"
  ]);

  return elements.map(({ text: name, attributes }) => {
    const kind = attributes["data-kind"];
    const remainingRaw = attributes["data-remaining"];
    const activeRaw = attributes["data-active"];
    if (kind === "product") return { kind, name };
    if (
      kind !== "class_package" ||
      remainingRaw == null ||
      remainingRaw.trim() === "" ||
      (activeRaw !== "true" && activeRaw !== "false")
    ) {
      throw new CheckoutReadError();
    }
    const remaining = Number(remainingRaw);
    if (!Number.isFinite(remaining)) throw new CheckoutReadError();
    return { kind, name, remaining, active: activeRaw === "true" };
  });
}
