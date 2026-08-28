import type { Locator, Page } from "playwright";

import {
  withPersistentBrowser,
  type BrowserContextLike,
  type PersistentBrowserLauncher
} from "./browser-session.js";
import {
  inspectCheckoutSnapshot,
  type RawCheckoutSnapshot
} from "./checkout-inspection.js";
import type {
  BookingRequest,
  CheckoutObservation,
  ExpectedClass,
  PermittedAction
} from "./contracts.js";
import type { PackageOption } from "./package-selection.js";
import { validateCheckoutUrl } from "./url-policy.js";

export type BookingPageState = Readonly<{
  observation: Extract<CheckoutObservation, { status: "observed" }>;
  myself: Readonly<{
    visibleCount: number;
    selected: boolean;
    enabled: boolean;
  }>;
  injuries: Readonly<{
    visibleCount: number;
    value: string;
    enabled: boolean;
  }>;
  packages: readonly PackageOption[];
  selectedPackageRow?: number;
  cancellation: Readonly<{
    visibleCount: number;
    accepted: boolean;
    enabled: boolean;
  }>;
  submission: Readonly<
    Record<
      PermittedAction,
      Readonly<{ visibleCount: number; enabled: boolean }>
    >
  >;
  confirmation: Readonly<{
    bookedVisibleCount: number;
    waitlistedVisibleCount: number;
  }>;
}>;

export type BookingConfirmation = "BOOKED" | "WAITLISTED" | "UNKNOWN";

export type BookingPage = Readonly<{
  read(): Promise<BookingPageState>;
  selectMyself(): Promise<void>;
  fillInjuriesIfEmpty(value: "None"): Promise<void>;
  selectPackage(row: number): Promise<void>;
  acceptCancellationPolicy(): Promise<void>;
  submit(action: PermittedAction): Promise<void>;
  waitForConfirmation(action: PermittedAction): Promise<BookingConfirmation>;
}>;

export type BookingBrowser = <T>(
  profileDir: string,
  checkoutUrl: string,
  use: (page: BookingPage) => Promise<T>
) => Promise<T>;

type BookingPageOptions = Readonly<{
  confirmationTimeoutMs?: number;
}>;

type BookingBrowserOptions = Readonly<{
  readinessTimeoutMs?: number;
}>;

type ControlState = Readonly<{
  visibleCount: number;
  selected: boolean;
  enabled: boolean;
}>;

type RawPageState = Readonly<{
  checkout: RawCheckoutSnapshot;
  myself: ControlState;
  injuries: Readonly<{
    visibleCount: number;
    value: string;
    enabled: boolean;
  }>;
  packages: readonly PackageOption[];
  selectedPackageRows: readonly number[];
  cancellation: Readonly<{
    visibleCount: number;
    accepted: boolean;
    enabled: boolean;
  }>;
  submission: BookingPageState["submission"];
  confirmation: BookingPageState["confirmation"];
}>;

class BookingPageError extends Error {
  readonly code = "BOOKING_PAGE_UNAVAILABLE";

  constructor() {
    super("Booking page could not be read.");
    this.name = "BookingPageError";
  }
}

class BookingPageControlError extends Error {
  readonly code = "BOOKING_PAGE_CONTROL_UNAVAILABLE";

  constructor() {
    super("Booking page control is unavailable.");
    this.name = "BookingPageControlError";
  }
}

class BookingBrowserError extends Error {
  readonly code = "BOOKING_BROWSER_NAVIGATION_FAILED";

  constructor() {
    super("Booking browser navigation failed.");
    this.name = "BookingBrowserError";
  }
}

class BookingBrowserReadinessError extends Error {
  readonly code = "BOOKING_BROWSER_READINESS_FAILED";

  constructor() {
    super("Booking browser readiness failed.");
    this.name = "BookingBrowserReadinessError";
  }
}

export function createBookingPage(
  page: Page,
  expectedClass: ExpectedClass,
  options: BookingPageOptions = {}
): BookingPage {
  const confirmationTimeoutMs = options.confirmationTimeoutMs ?? 30_000;
  let lastReadConfirmation: BookingPageState["confirmation"] | undefined;
  let preSubmissionUrl: string | undefined;
  return {
    read: async () => {
      const state = await readBookingPage(page, expectedClass);
      lastReadConfirmation = state.confirmation;
      return state;
    },
    selectMyself: () =>
      checkExactControl(page.locator('input[type="radio"][name="reserveFor"]')),
    fillInjuriesIfEmpty: (value) => fillEmptyInjuries(page, value),
    selectPackage: (row) => selectPackageRow(page, row),
    acceptCancellationPolicy: () =>
      checkExactControl(
        page.locator('input[type="checkbox"]').and(
          page.getByRole("checkbox", {
            name: "I agree to the Cancellation Policy",
            exact: true
          })
        )
      ),
    submit: async (action) => {
      preSubmissionUrl = page.url();
      await submitExactAction(page, action);
    },
    waitForConfirmation: (action) =>
      waitForExactConfirmation(
        page,
        action,
        confirmationTimeoutMs,
        lastReadConfirmation,
        preSubmissionUrl
      )
  };
}

export function createBookingBrowser(
  expectedClass: ExpectedClass,
  launcher?: PersistentBrowserLauncher,
  options: BookingBrowserOptions = {}
): BookingBrowser {
  return (profileDir, checkoutUrl, use) =>
    openBookingBrowser(
      expectedClass,
      profileDir,
      checkoutUrl,
      use,
      launcher,
      options.readinessTimeoutMs ?? 30_000
    );
}

async function openBookingBrowser<T>(
  expectedClass: ExpectedClass,
  profileDir: string,
  checkoutUrl: string,
  use: (page: BookingPage) => Promise<T>,
  launcher: PersistentBrowserLauncher | undefined,
  readinessTimeoutMs: number
): Promise<T> {
  const validatedUrl = validateCheckoutUrl(checkoutUrl).href;
  const inContext = async (context: BrowserContextLike): Promise<T> => {
    const page = context.pages()[0] ?? (await context.newPage());
    try {
      await page.goto(validatedUrl, { waitUntil: "domcontentloaded" });
      if (validateCheckoutUrl(page.url()).href !== validatedUrl) {
        throw new Error("redirected");
      }
    } catch {
      throw new BookingBrowserError();
    }
    try {
      await page
        .locator(
          '[data-testid="authenticated"], [data-testid="login-required"]'
        )
        .filter({ visible: true })
        .first()
        .waitFor({ state: "visible", timeout: readinessTimeoutMs });
    } catch {
      throw new BookingBrowserReadinessError();
    }
    try {
      if (validateCheckoutUrl(page.url()).href !== validatedUrl) {
        throw new Error("redirected");
      }
    } catch {
      throw new BookingBrowserError();
    }
    return use(createBookingPage(page, expectedClass));
  };

  return launcher === undefined
    ? withPersistentBrowser(profileDir, inContext)
    : withPersistentBrowser(profileDir, inContext, launcher);
}

async function exactEnabledVisible(locator: Locator): Promise<Locator> {
  try {
    const visible = locator.filter({ visible: true });
    if ((await visible.count()) !== 1 || !(await visible.isEnabled())) {
      throw new Error("unavailable");
    }
    return visible;
  } catch {
    throw new BookingPageControlError();
  }
}

async function checkExactControl(locator: Locator): Promise<void> {
  try {
    await (await exactEnabledVisible(locator)).check();
  } catch {
    throw new BookingPageControlError();
  }
}

async function fillEmptyInjuries(page: Page, value: "None"): Promise<void> {
  try {
    const input = await exactEnabledVisible(
      page.locator('input[type="text"], input:not([type])').and(
        page.getByRole("textbox", {
          name: /^Do you have any injuries\?(?:\s*\*)?\s*$/u
        })
      )
    );
    if ((await input.inputValue()).trim().length === 0) {
      await input.fill(value);
    }
  } catch {
    throw new BookingPageControlError();
  }
}

async function selectPackageRow(page: Page, row: number): Promise<void> {
  if (!Number.isSafeInteger(row) || row < 0) {
    throw new BookingPageControlError();
  }
  try {
    const offering = page
      .locator('[data-testid="offering"]')
      .filter({ visible: true })
      .nth(row);
    await checkExactControl(offering.locator('input[type="radio"]'));
  } catch {
    throw new BookingPageControlError();
  }
}

async function submitExactAction(
  page: Page,
  action: PermittedAction
): Promise<void> {
  try {
    const button =
      action === "book"
        ? page.getByRole("button", { name: "Book", exact: true })
        : page.getByRole("button", {
            name: "Join the waitlist",
            exact: true
          });
    await (await exactEnabledVisible(button)).click();
  } catch {
    throw new BookingPageControlError();
  }
}

type ConfirmationCounts = Readonly<{
  bookedVisibleCount: number;
  waitlistedVisibleCount: number;
  navigated: boolean;
}>;

async function waitForExactConfirmation(
  page: Page,
  action: PermittedAction,
  timeoutMs: number,
  preSubmission: BookingPageState["confirmation"] | undefined,
  preSubmissionUrl: string | undefined
): Promise<BookingConfirmation> {
  if (
    preSubmission === undefined ||
    preSubmissionUrl === undefined ||
    preSubmission.bookedVisibleCount !== 0 ||
    preSubmission.waitlistedVisibleCount !== 0
  ) {
    return "UNKNOWN";
  }

  try {
    if (page.url() !== preSubmissionUrl) return "UNKNOWN";
    const handle = await page.waitForFunction(
      ({ initialUrl: expectedUrl }): false | ConfirmationCounts => {
        if (window.location.href !== expectedUrl) {
          return {
            bookedVisibleCount: 0,
            waitlistedVisibleCount: 0,
            navigated: true
          };
        }
        const isVisible = (element: Element): element is HTMLElement => {
          if (!(element instanceof HTMLElement) || element.hidden) return false;
          const style = getComputedStyle(element);
          if (style.display === "none" || style.visibility === "hidden") {
            return false;
          }
          const box = element.getBoundingClientRect();
          return box.width > 0 && box.height > 0;
        };
        const exactLeafTextCount = (expected: string): number =>
          Array.from(document.querySelectorAll("body *")).filter((element) => {
            if (!isVisible(element)) return false;
            if ((element.textContent ?? "").trim() !== expected) return false;
            return !Array.from(element.children).some(
              (child) => (child.textContent ?? "").trim() === expected
            );
          }).length;
        const counts = {
          bookedVisibleCount: exactLeafTextCount("You are Booked!"),
          waitlistedVisibleCount: exactLeafTextCount("You're on the waitlist"),
          navigated: false
        };
        return counts.bookedVisibleCount + counts.waitlistedVisibleCount === 0
          ? false
          : counts;
      },
      { initialUrl: preSubmissionUrl },
      { polling: 25, timeout: timeoutMs }
    );
    const counts = (await handle.jsonValue()) as ConfirmationCounts;
    await handle.dispose();
    if (
      counts.navigated ||
      counts.bookedVisibleCount + counts.waitlistedVisibleCount !== 1
    ) {
      return "UNKNOWN";
    }
    if (action === "book" && counts.bookedVisibleCount === 1) {
      return "BOOKED";
    }
    if (action === "waitlist" && counts.waitlistedVisibleCount === 1) {
      return "WAITLISTED";
    }
    return "UNKNOWN";
  } catch {
    return "UNKNOWN";
  }
}

async function readBookingPage(
  page: Page,
  expectedClass: ExpectedClass
): Promise<BookingPageState> {
  try {
    const raw = await page.locator("body").evaluate((root): RawPageState => {
      const isVisible = (element: Element): element is HTMLElement => {
        if (!(element instanceof HTMLElement) || element.hidden) return false;
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden") {
          return false;
        }
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      };
      const visible = (selector: string): HTMLElement[] =>
        Array.from(root.querySelectorAll(selector)).filter(isVisible);
      const singletonCount = (selector: string): number => {
        const count = visible(selector).length;
        if (count > 1) throw new Error("ambiguous marker");
        return count;
      };
      const requiredText = (container: Element, testId: string): string => {
        const element = container.querySelector(`[data-testid="${testId}"]`);
        if (element === null || !isVisible(element)) {
          throw new Error("incomplete class");
        }
        return element.textContent ?? "";
      };
      const isEnabled = (element: HTMLElement): boolean =>
        !element.matches(":disabled") &&
        element.getAttribute("aria-disabled") !== "true";
      const ensureAtMostOne = <T>(values: readonly T[]): void => {
        if (values.length > 1) throw new Error("ambiguous control");
      };
      const inputState = (
        elements: readonly HTMLInputElement[]
      ): ControlState => {
        ensureAtMostOne(elements);
        const input = elements[0];
        return {
          visibleCount: elements.length,
          selected: input?.checked ?? false,
          enabled: input === undefined ? false : isEnabled(input)
        };
      };
      const normalizeAccessibleName = (value: string): string =>
        value.replace(/\s+/gu, " ").trim();
      const effectiveAccessibleName = (input: HTMLInputElement): string => {
        const labelledBy = input.getAttribute("aria-labelledby");
        if (labelledBy !== null) {
          return normalizeAccessibleName(
            labelledBy
              .split(/\s+/u)
              .filter((id) => id.length > 0)
              .map(
                (id) =>
                  input.ownerDocument.getElementById(id)?.textContent ?? ""
              )
              .join(" ")
          );
        }
        const ariaLabel = input.getAttribute("aria-label");
        if (ariaLabel !== null) {
          return normalizeAccessibleName(ariaLabel);
        }
        return normalizeAccessibleName(
          Array.from(input.labels ?? [])
            .map((label) => label.textContent ?? "")
            .join(" ")
        );
      };
      const inputsWithAccessibleName = (
        selector: string,
        matches: (value: string) => boolean
      ): HTMLInputElement[] =>
        visible(selector)
          .filter(
            (element): element is HTMLInputElement =>
              element instanceof HTMLInputElement
          )
          .filter((input) => matches(effectiveAccessibleName(input)));
      const exactButtons = (name: string): HTMLElement[] =>
        visible('button, input[type="button"], input[type="submit"]').filter(
          (element) => {
            const aria = element.getAttribute("aria-label");
            const text =
              element instanceof HTMLInputElement
                ? element.value
                : (element.textContent ?? "").trim();
            return (aria ?? text) === name;
          }
        );
      const submissionState = (
        elements: readonly HTMLElement[]
      ): Readonly<{ visibleCount: number; enabled: boolean }> => {
        ensureAtMostOne(elements);
        return {
          visibleCount: elements.length,
          enabled: elements[0] === undefined ? false : isEnabled(elements[0])
        };
      };
      const exactLeafTextCount = (expected: string): number =>
        visible("body *").filter((element) => {
          if ((element.textContent ?? "").trim() !== expected) return false;
          return !Array.from(element.children).some(
            (child) => (child.textContent ?? "").trim() === expected
          );
        }).length;

      const classes = visible('[data-testid="class"]').map((element) => ({
        name: requiredText(element, "class-name"),
        instructor: requiredText(element, "instructor"),
        date: requiredText(element, "class-date"),
        start_time: requiredText(element, "start-time"),
        end_time: requiredText(element, "end-time"),
        timezone: requiredText(element, "timezone")
      }));

      const actionSelectors = [
        ["book", '[data-testid="action-book"]'],
        ["waitlist", '[data-testid="action-waitlist"]'],
        ["sold_out", '[data-testid="state-sold-out"]'],
        ["already_booked", '[data-testid="state-already-booked"]'],
        ["already_waitlisted", '[data-testid="state-already-waitlisted"]']
      ] as const;
      const actions = actionSelectors.flatMap(([action, selector]) =>
        singletonCount(selector) === 1 ? [action] : []
      );

      const packageElements = visible('[data-testid="offering"]');
      const packages = packageElements.map((element, row): PackageOption => {
        const kind = element.getAttribute("data-kind");
        if (kind !== "class_package" && kind !== "product") {
          throw new Error("invalid offering");
        }
        const controls = Array.from(
          element.querySelectorAll('input[type="radio"]')
        ).filter(
          (candidate): candidate is HTMLInputElement =>
            candidate instanceof HTMLInputElement && isVisible(candidate)
        );
        const control = inputState(controls);
        const name = (element.textContent ?? "").trim();
        if (kind === "product") {
          return {
            row,
            name,
            remaining: 0,
            active: false,
            product: true,
            control
          };
        }
        const remainingRaw = element.getAttribute("data-remaining");
        const activeRaw = element.getAttribute("data-active");
        if (
          remainingRaw === null ||
          !/^(?:0|[1-9][0-9]*)$/u.test(remainingRaw) ||
          (activeRaw !== "true" && activeRaw !== "false")
        ) {
          throw new Error("invalid offering");
        }
        const remaining = Number(remainingRaw);
        if (!Number.isSafeInteger(remaining)) {
          throw new Error("invalid offering");
        }
        return {
          row,
          name,
          remaining,
          active: activeRaw === "true",
          product: false,
          control
        };
      });
      const selectedPackageRows = packages
        .filter((option) => option.control.selected)
        .map((option) => option.row);
      ensureAtMostOne(selectedPackageRows);

      const myself = visible('input[type="radio"][name="reserveFor"]').filter(
        (element): element is HTMLInputElement =>
          element instanceof HTMLInputElement
      );
      const injuryInputs = inputsWithAccessibleName(
        'input[type="text"], input:not([type])',
        (value) => /^Do you have any injuries\?(?:\s*\*)?\s*$/u.test(value)
      );
      ensureAtMostOne(injuryInputs);
      const injuryInput = injuryInputs[0];
      const cancellationInputs = inputsWithAccessibleName(
        'input[type="checkbox"]',
        (value) => value.trim() === "I agree to the Cancellation Policy"
      );
      ensureAtMostOne(cancellationInputs);
      const cancellationInput = cancellationInputs[0];
      const book = exactButtons("Book");
      const waitlist = exactButtons("Join the waitlist");

      const offerings: RawCheckoutSnapshot["offerings"] = packages.map(
        (option) =>
          option.product
            ? { kind: "product", name: option.name }
            : {
                kind: "class_package",
                name: option.name,
                remaining: option.remaining,
                active: option.active
              }
      );

      return {
        checkout: {
          authenticated: singletonCount('[data-testid="authenticated"]') === 1,
          login_required:
            singletonCount('[data-testid="login-required"]') === 1,
          classes,
          actions,
          offerings
        },
        myself: inputState(myself),
        injuries: {
          visibleCount: injuryInputs.length,
          value:
            injuryInput === undefined || injuryInput.value.trim().length === 0
              ? ""
              : "PRESENT",
          enabled: injuryInput === undefined ? false : isEnabled(injuryInput)
        },
        packages,
        selectedPackageRows,
        cancellation: {
          visibleCount: cancellationInputs.length,
          accepted: cancellationInput?.checked ?? false,
          enabled:
            cancellationInput === undefined
              ? false
              : isEnabled(cancellationInput)
        },
        submission: {
          book: submissionState(book),
          waitlist: submissionState(waitlist)
        },
        confirmation: {
          bookedVisibleCount: exactLeafTextCount("You are Booked!"),
          waitlistedVisibleCount: exactLeafTextCount("You're on the waitlist")
        }
      };
    });

    const observation = inspectCheckoutSnapshot(
      inspectionRequest(expectedClass),
      raw.checkout
    );
    if (observation.status !== "observed") throw new Error("not observed");

    return {
      observation,
      myself: raw.myself,
      injuries: raw.injuries,
      packages: raw.packages,
      ...(raw.selectedPackageRows[0] === undefined
        ? {}
        : { selectedPackageRow: raw.selectedPackageRows[0] }),
      cancellation: raw.cancellation,
      submission: raw.submission,
      confirmation: raw.confirmation
    };
  } catch {
    throw new BookingPageError();
  }
}

function inspectionRequest(expectedClass: ExpectedClass): BookingRequest {
  return {
    schema_version: 1,
    request_id: "00000000-0000-4000-8000-000000000000",
    booking_url:
      "https://app.arketa.co/iframe/synthetic/calendar/checkout/synthetic",
    expected_class: expectedClass,
    reserve_for: "myself",
    permitted_actions: ["book", "waitlist"],
    policy_version: "booking-page-inspection",
    allow_monetary_charge: false,
    dry_run: false
  };
}
