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

type BookingPageOptions = Readonly<{ confirmationTimeoutMs?: number }>;

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
      checkExactControl(
        page
          .locator('input[type="radio"][name="reserveFor"]')
          .and(page.getByRole("radio", { name: "Myself", exact: true }))
      ),
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
      await waitForBookingReady(page, readinessTimeoutMs);
    } catch {
      throw new BookingBrowserReadinessError();
    }
    return use(createBookingPage(page, expectedClass));
  };

  return launcher === undefined
    ? withPersistentBrowser(profileDir, inContext)
    : withPersistentBrowser(profileDir, inContext, launcher);
}

async function waitForBookingReady(
  page: Page,
  timeoutMs: number
): Promise<void> {
  await page.waitForFunction(
    () => {
      const visible = (element: Element | null): element is HTMLElement => {
        if (!(element instanceof HTMLElement)) return false;
        const style = getComputedStyle(element);
        return (
          !element.hidden &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          element.getClientRects().length > 0
        );
      };
      const visibleMarker = (selector: string): boolean =>
        [...document.querySelectorAll(selector)].some(visible);
      const liveTitles = [...document.querySelectorAll(".classTitle")].filter(
        visible
      );
      if (liveTitles.length > 0) {
        if (liveTitles.length !== 1) return false;
        const title = liveTitles[0]!;
        const sibling = title.nextElementSibling;
        const instructor = sibling?.nextElementSibling ?? null;
        const exactVisibleInput = (
          selector: string,
          accessibleName: string
        ): boolean => {
          const matches = [...document.querySelectorAll(selector)].filter(
            (candidate): candidate is HTMLInputElement => {
              if (
                !(candidate instanceof HTMLInputElement) ||
                !visible(candidate)
              ) {
                return false;
              }
              const labels = [...(candidate.labels ?? [])]
                .map((label) =>
                  (label.textContent ?? "").replace(/\s+/gu, " ").trim()
                )
                .join(" ");
              return labels === accessibleName;
            }
          );
          return matches.length === 1;
        };
        const actions = [...document.querySelectorAll("button")].filter(
          (button) =>
            visible(button) &&
            ["Book", "Join the waitlist"].includes(
              (button.textContent ?? "").replace(/\s+/gu, " ").trim()
            )
        );
        const packages = [...document.querySelectorAll("div.card")].filter(
          (card) =>
            visible(card) &&
            card.closest("a[href]") === null &&
            card.querySelector("h1,h2,h3,h4,h5,h6") !== null &&
            card.querySelector("p") !== null
        );
        return (
          visible(sibling) &&
          visible(instructor) &&
          actions.length === 1 &&
          packages.length > 0 &&
          exactVisibleInput(
            'input[type="radio"][name="reserveFor"]',
            "Myself"
          ) &&
          [
            ...document.querySelectorAll(
              'input[type="text"], input:not([type])'
            )
          ].filter(
            (input) =>
              input instanceof HTMLInputElement &&
              visible(input) &&
              [...(input.labels ?? [])].some((label) =>
                /^Do you have any injuries\?(?:\s*\*)?\s*$/u.test(
                  (label.textContent ?? "").replace(/\s+/gu, " ").trim()
                )
              )
          ).length === 1 &&
          exactVisibleInput(
            'input[type="checkbox"]',
            "I agree to the Cancellation Policy"
          )
        );
      }
      if (visibleMarker('[data-testid="login-required"]')) return true;
      if (!visibleMarker('[data-testid="authenticated"]')) return false;
      const classMetadataPresent = [
        '[data-testid="class-name"]',
        '[data-testid="instructor"]',
        '[data-testid="class-date"]',
        '[data-testid="start-time"]',
        '[data-testid="end-time"]',
        '[data-testid="timezone"]'
      ].every(visibleMarker);
      if (!classMetadataPresent) return false;
      if (
        visibleMarker('[data-testid="state-sold-out"]') ||
        visibleMarker('[data-testid="state-already-booked"]') ||
        visibleMarker('[data-testid="state-already-waitlisted"]')
      ) {
        return true;
      }
      if (
        !visibleMarker('[data-testid="action-book"]') &&
        !visibleMarker('[data-testid="action-waitlist"]')
      ) {
        return false;
      }
      const labeledControlPresent = (
        labelText: string,
        inputType: string
      ): boolean =>
        [...document.querySelectorAll("label")].some((candidate) => {
          if (!visible(candidate)) return false;
          const normalized = (candidate.textContent ?? "")
            .trim()
            .replace(/\s*\*\s*$/, "");
          if (normalized !== labelText) return false;
          const target = candidate.htmlFor
            ? document.getElementById(candidate.htmlFor)
            : candidate.querySelector("input");
          return (
            target instanceof HTMLInputElement &&
            target.type === inputType &&
            visible(target)
          );
        });
      const packageControlPresent = [
        ...document.querySelectorAll('[data-testid="offering"]')
      ].some(
        (offering) =>
          visible(offering) &&
          offering.getAttribute("data-kind") === "class_package" &&
          [...offering.querySelectorAll('input[type="radio"]')].some(visible)
      );
      return (
        labeledControlPresent("Myself", "radio") &&
        labeledControlPresent("Do you have any injuries?", "text") &&
        labeledControlPresent(
          "I agree to the Cancellation Policy",
          "checkbox"
        ) &&
        packageControlPresent
      );
    },
    undefined,
    { timeout: timeoutMs }
  );
}

async function exactEnabledVisible(locator: Locator): Promise<Locator> {
  try {
    const visible = locator.filter({ visible: true });
    if (
      (await visible.count()) !== 1 ||
      !(await isMainLightDom(visible)) ||
      !(await visible.isEnabled())
    ) {
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
    if (await hasLiveCheckout(page)) {
      const cards = livePackageCards(page);
      if ((await cards.count()) <= row) throw new Error("missing package");
      await (await exactEnabledVisible(cards.nth(row))).click();
      return;
    }
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
    const button = (await hasLiveCheckout(page))
      ? accessibleActionButton(page, action)
      : exactActionButton(page, action);
    await button.click({ timeout: 250 });
  } catch {
    throw new BookingPageControlError();
  }
}

function exactActionButton(page: Page, action: PermittedAction): Locator {
  const marker = page.locator(
    action === "book"
      ? '[data-testid="action-book"]'
      : '[data-testid="action-waitlist"]'
  );
  return marker.and(accessibleActionButton(page, action));
}

function accessibleActionButton(page: Page, action: PermittedAction): Locator {
  return action === "book"
    ? page.getByRole("button", { name: "Book", exact: true })
    : page.getByRole("button", {
        name: "Join the waitlist",
        exact: true
      });
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
    if (await hasLiveCheckout(page)) {
      return await readLiveBookingPage(page, expectedClass);
    }
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
        const elements = Array.from(
          container.querySelectorAll(`[data-testid="${testId}"]`)
        ).filter(isVisible);
        if (elements.length !== 1) {
          throw new Error("incomplete class");
        }
        return elements[0]?.textContent ?? "";
      };
      const isEnabled = (element: HTMLElement): boolean =>
        !element.matches(":disabled") &&
        element.closest('[aria-disabled="true"]') === null;
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

      const myself = inputsWithAccessibleName(
        'input[type="radio"][name="reserveFor"]',
        (value) => value === "Myself"
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
    const [book, waitlist] = await Promise.all([
      readExactActionState(page, "book"),
      readExactActionState(page, "waitlist")
    ]);

    return {
      observation,
      myself: raw.myself,
      injuries: raw.injuries,
      packages: raw.packages,
      ...(raw.selectedPackageRows[0] === undefined
        ? {}
        : { selectedPackageRow: raw.selectedPackageRows[0] }),
      cancellation: raw.cancellation,
      submission: { book, waitlist },
      confirmation: raw.confirmation
    };
  } catch {
    throw new BookingPageError();
  }
}

async function hasLiveCheckout(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    return [...document.querySelectorAll(".classTitle")].some((element) => {
      if (!(element instanceof HTMLElement) || element.hidden) return false;
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden";
    });
  });
}

async function readLiveBookingPage(
  page: Page,
  expectedClass: ExpectedClass
): Promise<BookingPageState> {
  const title = page.locator(".classTitle").filter({ visible: true });
  if ((await title.count()) !== 1) throw new Error("ambiguous class");
  const metadata = title.locator("xpath=following-sibling::*");
  if ((await metadata.count()) < 2) throw new Error("incomplete class");
  const dateTimeText = (await metadata.nth(0).innerText()).trim();
  const instructorText = (await metadata.nth(1).innerText()).trim();
  const parsed = parseLiveDateTime(dateTimeText, expectedClass);
  if (!instructorText.startsWith("with ")) throw new Error("incomplete class");

  const myselfLocator = page
    .locator('input[type="radio"][name="reserveFor"]')
    .and(page.getByRole("radio", { name: "Myself", exact: true }))
    .filter({ visible: true });
  const injuryLocator = page
    .locator('input[type="text"], input:not([type])')
    .and(
      page.getByRole("textbox", {
        name: /^Do you have any injuries\?(?:\s*\*)?\s*$/u
      })
    )
    .filter({ visible: true });
  const cancellationLocator = page
    .locator('input[type="checkbox"]')
    .and(
      page.getByRole("checkbox", {
        name: "I agree to the Cancellation Policy",
        exact: true
      })
    )
    .filter({ visible: true });
  if (
    (await myselfLocator.count()) > 1 ||
    (await injuryLocator.count()) > 1 ||
    (await cancellationLocator.count()) > 1
  ) {
    throw new Error("ambiguous control");
  }
  for (const control of [myselfLocator, injuryLocator, cancellationLocator]) {
    if ((await control.count()) === 1 && !(await isMainLightDom(control))) {
      throw new Error("unsupported control boundary");
    }
  }

  const cards = livePackageCards(page);
  const packages: PackageOption[] = [];
  const selectedRows: number[] = [];
  for (let row = 0; row < (await cards.count()); row += 1) {
    const card = cards.nth(row);
    const heading = card.getByRole("heading").filter({ visible: true });
    const balances = card.locator("p").filter({ visible: true });
    if ((await heading.count()) !== 1 || (await balances.count()) !== 1) {
      throw new Error("invalid package");
    }
    const balanceMatch = (await balances.innerText())
      .trim()
      .match(/^(0|[1-9][0-9]*) remaining$/u);
    if (balanceMatch?.[1] === undefined) throw new Error("invalid package");
    const remaining = Number(balanceMatch[1]);
    if (!Number.isSafeInteger(remaining)) throw new Error("invalid package");
    const selected = await card.evaluate((element) =>
      element.classList.contains("border-primaryColor")
    );
    if (selected) selectedRows.push(row);
    packages.push({
      row,
      name: (await heading.innerText()).trim(),
      remaining,
      active: remaining > 0,
      product: false,
      control: {
        visibleCount: 1,
        selected,
        enabled: await card.isEnabled()
      }
    });
  }
  if (selectedRows.length > 1) throw new Error("ambiguous package");

  const [book, waitlist] = await Promise.all([
    readLiveActionState(page, "book"),
    readLiveActionState(page, "waitlist")
  ]);
  const actions = [
    ...(book.visibleCount === 1 ? (["book"] as const) : []),
    ...(waitlist.visibleCount === 1 ? (["waitlist"] as const) : [])
  ];
  if (actions.length !== 1) throw new Error("ambiguous action");
  const confirmation = await readConfirmationCounts(page);
  return {
    observation: {
      status: "observed",
      observed_class: {
        name: (await title.innerText()).trim(),
        instructor: instructorText.slice("with ".length).trim(),
        date: expectedClass.date,
        start_time: parsed.start,
        end_time: parsed.end,
        timezone: expectedClass.timezone
      },
      action: actions[0]!,
      packages: packages.map(({ name, remaining }) => ({
        name,
        remaining,
        approved: false
      }))
    },
    myself: await readRadioState(myselfLocator),
    injuries: {
      visibleCount: await injuryLocator.count(),
      value:
        (await injuryLocator.count()) === 1 &&
        (await injuryLocator.inputValue()).trim().length > 0
          ? "PRESENT"
          : "",
      enabled:
        (await injuryLocator.count()) === 1 && (await injuryLocator.isEnabled())
    },
    packages,
    ...(selectedRows[0] === undefined
      ? {}
      : { selectedPackageRow: selectedRows[0] }),
    cancellation: {
      visibleCount: await cancellationLocator.count(),
      accepted:
        (await cancellationLocator.count()) === 1 &&
        (await cancellationLocator.isChecked()),
      enabled:
        (await cancellationLocator.count()) === 1 &&
        (await cancellationLocator.isEnabled())
    },
    submission: { book, waitlist },
    confirmation
  };
}

function livePackageCards(page: Page): Locator {
  return page
    .locator(
      'xpath=//div[contains(concat(" ", normalize-space(@class), " "), " card ") and not(ancestor::a[@href])]'
    )
    .filter({ visible: true });
}

async function readLiveActionState(
  page: Page,
  action: PermittedAction
): Promise<Readonly<{ visibleCount: number; enabled: boolean }>> {
  const visible = accessibleActionButton(page, action).filter({
    visible: true
  });
  const visibleCount = await visible.count();
  return {
    visibleCount,
    enabled:
      visibleCount === 1 &&
      (await isMainLightDom(visible)) &&
      (await visible.isEnabled())
  };
}

async function isMainLightDom(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => element.getRootNode() === document);
}

async function readRadioState(locator: Locator): Promise<ControlState> {
  const visibleCount = await locator.count();
  return {
    visibleCount,
    selected: visibleCount === 1 && (await locator.isChecked()),
    enabled: visibleCount === 1 && (await locator.isEnabled())
  };
}

async function readConfirmationCounts(
  page: Page
): Promise<BookingPageState["confirmation"]> {
  return page.evaluate(() => {
    const exactVisibleLeafCount = (expected: string): number =>
      [...document.querySelectorAll("body *")].filter((element) => {
        if (!(element instanceof HTMLElement) || element.hidden) return false;
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden")
          return false;
        if (element.getClientRects().length === 0) return false;
        if ((element.textContent ?? "").trim() !== expected) return false;
        return ![...element.children].some(
          (child) => (child.textContent ?? "").trim() === expected
        );
      }).length;
    return {
      bookedVisibleCount: exactVisibleLeafCount("You are Booked!"),
      waitlistedVisibleCount: exactVisibleLeafCount("You're on the waitlist")
    };
  });
}

function parseLiveDateTime(
  value: string,
  expectedClass: ExpectedClass
): Readonly<{ start: string; end: string }> {
  const match = value.match(
    /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ([1-9]|[12][0-9]|3[01]) • ([1-9]|1[0-2]):([0-5][0-9]) (AM|PM) - ([1-9]|1[0-2]):([0-5][0-9]) (AM|PM) ([A-Z]{2,5})$/u
  );
  if (match === null) throw new Error("invalid class time");
  const expectedDate = new Date(`${expectedClass.date}T12:00:00Z`);
  const expectedPrefix = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  }).format(expectedDate);
  if (`${match[1]}, ${match[2]} ${match[3]}` !== expectedPrefix) {
    throw new Error("class date mismatch");
  }
  const to24Hour = (hour: string, minute: string, meridiem: string): string => {
    const numeric = (Number(hour) % 12) + (meridiem === "PM" ? 12 : 0);
    return `${String(numeric).padStart(2, "0")}:${minute}`;
  };
  const start = to24Hour(match[4]!, match[5]!, match[6]!);
  const end = to24Hour(match[7]!, match[8]!, match[9]!);
  if (start !== expectedClass.start_time)
    throw new Error("class time mismatch");
  if (
    !zoneNamesForLocalDateTime(
      expectedClass.date,
      start,
      expectedClass.timezone
    ).has(match[10]!)
  ) {
    throw new Error("class timezone mismatch");
  }
  return { start, end };
}

function zoneNamesForLocalDateTime(
  date: string,
  time: string,
  timezone: string
): ReadonlySet<string> {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short"
  });
  const desired = `${date}T${time}`;
  const localAsUtc = Date.parse(`${desired}:00Z`);
  const names = new Set<string>();
  for (let offset = -14; offset <= 14; offset += 1) {
    const parts = formatter.formatToParts(
      new Date(localAsUtc + offset * 60 * 60 * 1000)
    );
    const value = (type: Intl.DateTimeFormatPartTypes): string | undefined =>
      parts.find((part) => part.type === type)?.value;
    if (
      `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}` ===
      desired
    ) {
      const zoneName = value("timeZoneName");
      if (zoneName !== undefined) names.add(zoneName);
    }
  }
  return names;
}

async function readExactActionState(
  page: Page,
  action: PermittedAction
): Promise<Readonly<{ visibleCount: number; enabled: boolean }>> {
  const visible = exactActionButton(page, action).filter({ visible: true });
  const visibleCount = await visible.count();
  return {
    visibleCount,
    enabled: visibleCount === 1 && (await visible.isEnabled())
  };
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
