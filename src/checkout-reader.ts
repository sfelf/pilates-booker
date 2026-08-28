import type { Page } from "playwright";

import type {
  RawCheckoutSnapshot,
  RawOffering
} from "./checkout-inspection.js";
import type { CheckoutAction, ObservedClass } from "./contracts.js";

const selectors = {
  authenticated: '[data-testid="authenticated"]',
  loginRequired: '[data-testid="login-required"]',
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
    }
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
  const fields = await Promise.all([
    page.texts(selectors.className),
    page.texts(selectors.instructor),
    page.texts(selectors.classDate),
    page.texts(selectors.startTime),
    page.texts(selectors.endTime),
    page.texts(selectors.timezone)
  ]);
  const length = fields[0].length;
  if (!fields.every((values) => values.length === length)) {
    throw new CheckoutReadError();
  }

  return Array.from({ length }, (_, index) => ({
    name: fields[0][index]!,
    instructor: fields[1][index]!,
    date: fields[2][index]!,
    start_time: fields[3][index]!,
    end_time: fields[4][index]!,
    timezone: fields[5][index]!
  }));
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
  const [names, kinds, remainingValues, activeValues] = await Promise.all([
    page.texts(selectors.package),
    page.attributes(selectors.package, "data-kind"),
    page.attributes(selectors.package, "data-remaining"),
    page.attributes(selectors.package, "data-active")
  ]);
  if (
    kinds.length !== names.length ||
    remainingValues.length !== names.length ||
    activeValues.length !== names.length
  ) {
    throw new CheckoutReadError();
  }

  return names.map((name, index) => {
    const kind = kinds[index];
    const remainingRaw = remainingValues[index];
    const activeRaw = activeValues[index];
    if (
      (kind !== "class_package" && kind !== "product") ||
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
