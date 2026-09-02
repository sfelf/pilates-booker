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
import type { CheckoutObservation, PermittedAction } from "./contracts.js";
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

export type BookingConfirmation =
  | Readonly<{ kind: "BOOKED"; googleCalendarUrl?: string }>
  | Readonly<{ kind: "WAITLISTED" }>
  | Readonly<{ kind: "UNKNOWN" }>;

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

export type BookingPageOptions = Readonly<{
  confirmationTimeoutMs?: number;
  classId?: string;
  now?: Date;
  timezone?: string;
}>;

export type ObservedClassHint = Readonly<{
  date: string;
  timezone: string;
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
  confirmation: BookingPageState["confirmation"];
}>;

class BookingPageError extends Error {
  readonly code = "BOOKING_PAGE_UNAVAILABLE";

  constructor(cause?: unknown) {
    super("Booking page could not be read.", { cause });
    this.name = "BookingPageError";
  }
}

class BookingPageControlError extends Error {
  readonly code = "BOOKING_PAGE_CONTROL_UNAVAILABLE";

  constructor(cause?: unknown) {
    super("Booking page control is unavailable.", { cause });
    this.name = "BookingPageControlError";
  }
}

class BookingBrowserError extends Error {
  readonly code = "BOOKING_BROWSER_NAVIGATION_FAILED";

  constructor(cause?: unknown) {
    super("Booking browser navigation failed.", { cause });
    this.name = "BookingBrowserError";
  }
}

class BookingBrowserReadinessError extends Error {
  readonly code = "BOOKING_BROWSER_READINESS_FAILED";

  constructor(cause?: unknown) {
    super("Booking browser readiness failed.", { cause });
    this.name = "BookingBrowserReadinessError";
  }
}

export function createBookingPage(
  page: Page,
  hintOrOptions: ObservedClassHint | BookingPageOptions = {},
  additionalOptions: BookingPageOptions = {}
): BookingPage {
  const options =
    "date" in hintOrOptions
      ? {
          ...additionalOptions,
          timezone: hintOrOptions.timezone,
          now: new Date(`${hintOrOptions.date}T00:00:00Z`)
        }
      : hintOrOptions;
  const confirmationTimeoutMs = options.confirmationTimeoutMs ?? 30_000;
  let lastReadConfirmation: BookingPageState["confirmation"] | undefined;
  return {
    read: async () => {
      const state = await readBookingPage(page, options);
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
    submit: (action) => submitExactAction(page, action),
    waitForConfirmation: (action) =>
      waitForExactConfirmation(
        page,
        action,
        confirmationTimeoutMs,
        lastReadConfirmation,
        options.classId
      )
  };
}

export function createBookingBrowser(
  hintOrLauncher?: ObservedClassHint | PersistentBrowserLauncher,
  launcherOrOptions?: PersistentBrowserLauncher | BookingBrowserOptions,
  additionalOptions: BookingBrowserOptions = {}
): BookingBrowser {
  const hint = typeof hintOrLauncher === "object" ? hintOrLauncher : undefined;
  const launcher =
    typeof hintOrLauncher === "function"
      ? hintOrLauncher
      : typeof launcherOrOptions === "function"
        ? launcherOrOptions
        : undefined;
  const options =
    typeof launcherOrOptions === "object" && hint === undefined
      ? launcherOrOptions
      : additionalOptions;
  return (profileDir, checkoutUrl, use) =>
    openBookingBrowser(
      profileDir,
      checkoutUrl,
      use,
      launcher,
      options.readinessTimeoutMs ?? 30_000,
      hint
    );
}

async function openBookingBrowser<T>(
  profileDir: string,
  checkoutUrl: string,
  use: (page: BookingPage) => Promise<T>,
  launcher: PersistentBrowserLauncher | undefined,
  readinessTimeoutMs: number,
  hint: ObservedClassHint | undefined
): Promise<T> {
  const validatedCheckoutUrl = validateCheckoutUrl(checkoutUrl);
  const validatedUrl = validatedCheckoutUrl.href;
  const inContext = async (context: BrowserContextLike): Promise<T> => {
    const page = context.pages()[0] ?? (await context.newPage());
    try {
      await page.goto(validatedUrl, { waitUntil: "domcontentloaded" });
      if (validateCheckoutUrl(page.url()).href !== validatedUrl) {
        throw new Error("redirected");
      }
    } catch (error) {
      throw new BookingBrowserError(error);
    }
    try {
      await waitForBookingReady(page, readinessTimeoutMs);
    } catch (error) {
      throw new BookingBrowserReadinessError(error);
    }
    const classId = validatedCheckoutUrl.pathname.split("/")[5];
    const pageOptions = classId === undefined ? {} : { classId };
    return use(
      hint === undefined
        ? createBookingPage(page, pageOptions)
        : createBookingPage(page, hint, pageOptions)
    );
  };

  return launcher === undefined
    ? withPersistentBrowser(profileDir, inContext)
    : withPersistentBrowser(profileDir, inContext, launcher);
}

export async function waitForBookingReady(
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
        const metadataBindings = [title, title.parentElement]
          .filter((anchor): anchor is HTMLElement => anchor !== null)
          .map((anchor) => {
            const dateTime = anchor.nextElementSibling;
            const instructor = dateTime?.nextElementSibling ?? null;
            const dateTimeText = (dateTime?.textContent ?? "")
              .replace(/\s+/gu, " ")
              .trim();
            const instructorText = (instructor?.textContent ?? "")
              .replace(/\s+/gu, " ")
              .trim();
            return { dateTime, instructor, dateTimeText, instructorText };
          })
          .filter(
            ({ dateTime, instructor, dateTimeText, instructorText }) =>
              visible(dateTime) &&
              visible(instructor) &&
              dateTimeText.includes(" • ") &&
              dateTimeText.includes(" - ") &&
              instructorText.startsWith("with ")
          );
        if (metadataBindings.length !== 1) return false;
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
        const booked = [...document.querySelectorAll("button")].filter(
          (button) =>
            visible(button) &&
            (button.textContent ?? "").replace(/\s+/gu, " ").trim() ===
              "Book Another Spot"
        );
        const waitlisted = [
          ...document.querySelectorAll("h1,h2,h3,h4,h5,h6")
        ].filter(
          (heading) =>
            visible(heading) &&
            (heading.textContent ?? "").replace(/\s+/gu, " ").trim() ===
              "You're on the waitlist"
        );
        const stateCount = actions.length + booked.length + waitlisted.length;
        if (stateCount !== 1) return false;
        if (booked.length === 1) {
          const section = booked[0]!.parentElement;
          const details =
            section === null
              ? []
              : [...section.querySelectorAll("button")].filter(
                  (button) =>
                    visible(button) &&
                    (button.textContent ?? "").replace(/\s+/gu, " ").trim() ===
                      "View Details"
                );
          return metadataBindings.length === 1 && details.length === 1;
        }
        if (waitlisted.length === 1) {
          return metadataBindings.length === 1;
        }
        const packages = [...document.querySelectorAll("div.card")].filter(
          (card) =>
            visible(card) &&
            card.closest("a[href]") === null &&
            card.querySelector("h1,h2,h3,h4,h5,h6") !== null &&
            card.querySelector("p") !== null
        );
        return (
          metadataBindings.length === 1 &&
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
  } catch (error) {
    throw new BookingPageControlError(error);
  }
}

async function checkExactControl(locator: Locator): Promise<void> {
  try {
    await (await exactEnabledVisible(locator)).check();
  } catch (error) {
    throw new BookingPageControlError(error);
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
  } catch (error) {
    throw new BookingPageControlError(error);
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
  } catch (error) {
    throw new BookingPageControlError(error);
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
  } catch (error) {
    throw new BookingPageControlError(error);
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
}>;

async function waitForExactConfirmation(
  page: Page,
  action: PermittedAction,
  timeoutMs: number,
  preSubmission: BookingPageState["confirmation"] | undefined,
  classId: string | undefined
): Promise<BookingConfirmation> {
  if (
    preSubmission === undefined ||
    preSubmission.bookedVisibleCount !== 0 ||
    preSubmission.waitlistedVisibleCount !== 0
  ) {
    return { kind: "UNKNOWN" };
  }

  const deadline = performance.now() + timeoutMs;
  const remainingMs = deadline - performance.now();
  if (remainingMs <= 0) return { kind: "UNKNOWN" };
  try {
    const handle = await page.waitForFunction(
      (): false | ConfirmationCounts => {
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
          waitlistedVisibleCount: exactLeafTextCount("You're on the waitlist")
        };
        return counts.bookedVisibleCount + counts.waitlistedVisibleCount === 0
          ? false
          : counts;
      },
      undefined,
      { polling: 25, timeout: remainingMs }
    );
    const counts = (await handle.jsonValue()) as ConfirmationCounts;
    await handle.dispose();
    if (counts.bookedVisibleCount + counts.waitlistedVisibleCount !== 1) {
      return { kind: "UNKNOWN" };
    }
    if (action === "book" && counts.bookedVisibleCount === 1) {
      const googleCalendarUrl = await waitForGoogleCalendarUrl(
        page,
        classId,
        deadline
      );
      return googleCalendarUrl === undefined
        ? { kind: "BOOKED" }
        : { kind: "BOOKED", googleCalendarUrl };
    }
    if (action === "waitlist" && counts.waitlistedVisibleCount === 1) {
      return { kind: "WAITLISTED" };
    }
    return { kind: "UNKNOWN" };
  } catch {
    return { kind: "UNKNOWN" };
  }
}

async function waitForGoogleCalendarUrl(
  page: Page,
  classId: string | undefined,
  deadline: number
): Promise<string | undefined> {
  if (classId === undefined) return undefined;
  const remainingMs = deadline - performance.now();
  if (remainingMs <= 0) return undefined;
  const expectedUrl = `https://app.arketa.co/api/calendar/google?classId=${classId}`;
  try {
    const handle = await page.waitForFunction(
      (expected): string | false => {
        const isVisible = (element: Element): element is HTMLElement => {
          if (!(element instanceof HTMLElement) || element.hidden) {
            return false;
          }
          const style = getComputedStyle(element);
          if (style.display === "none" || style.visibility === "hidden") {
            return false;
          }
          const box = element.getBoundingClientRect();
          return box.width > 0 && box.height > 0;
        };
        const links = Array.from(document.querySelectorAll("a")).filter(
          (link) =>
            isVisible(link) &&
            (link.textContent ?? "").replace(/\s+/gu, " ").trim() === "Google"
        );
        return links.length === 1 && links[0]?.getAttribute("href") === expected
          ? expected
          : false;
      },
      expectedUrl,
      { polling: 25, timeout: remainingMs }
    );
    const googleCalendarUrl = await handle.jsonValue();
    await handle.dispose();
    return typeof googleCalendarUrl === "string"
      ? googleCalendarUrl
      : undefined;
  } catch {
    return undefined;
  }
}

async function readBookingPage(
  page: Page,
  options: BookingPageOptions
): Promise<BookingPageState> {
  try {
    if (await hasLiveCheckout(page)) {
      return await readLiveBookingPage(page, options);
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

    const observation = inspectCheckoutSnapshot(raw.checkout);
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
  } catch (error) {
    throw new BookingPageError(error);
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
  options: BookingPageOptions
): Promise<BookingPageState> {
  const title = page.locator(".classTitle").filter({ visible: true });
  if ((await title.count()) !== 1) throw new Error("ambiguous class");
  const metadata = await title.evaluate((element) => {
    if (!(element instanceof HTMLElement)) {
      throw new Error("unsupported class title");
    }
    const visible = (candidate: Element | null): candidate is HTMLElement => {
      if (!(candidate instanceof HTMLElement) || candidate.hidden) return false;
      const style = getComputedStyle(candidate);
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        candidate.getClientRects().length > 0
      );
    };
    const bindings = [element, element.parentElement]
      .filter((anchor): anchor is HTMLElement => anchor !== null)
      .map((anchor) => {
        const dateTime = anchor.nextElementSibling;
        const instructor = dateTime?.nextElementSibling ?? null;
        const dateTimeText = (dateTime?.textContent ?? "")
          .replace(/\s+/gu, " ")
          .trim();
        const instructorText = (instructor?.textContent ?? "")
          .replace(/\s+/gu, " ")
          .trim();
        return { dateTime, instructor, dateTimeText, instructorText };
      })
      .filter(
        ({ dateTime, instructor, dateTimeText, instructorText }) =>
          visible(dateTime) &&
          visible(instructor) &&
          dateTimeText.includes(" • ") &&
          dateTimeText.includes(" - ") &&
          instructorText.startsWith("with ")
      );
    if (bindings.length !== 1) throw new Error("ambiguous class metadata");
    return {
      dateTimeText: bindings[0]!.dateTimeText,
      instructorText: bindings[0]!.instructorText
    };
  });
  const { dateTimeText, instructorText } = metadata;
  const parsed = parseLiveDateTime(
    dateTimeText,
    options.timezone,
    options.now ?? new Date()
  );
  if (!instructorText.startsWith("with ")) throw new Error("incomplete class");
  const observedClass = {
    name: (await title.innerText()).trim(),
    instructor: instructorText.slice("with ".length).trim(),
    date: parsed.date,
    start_time: parsed.start,
    end_time: parsed.end,
    timezone: options.timezone ?? parsed.timezone
  };
  const enrollment = await readLiveEnrollment(page);
  if (enrollment !== undefined) {
    return {
      observation: {
        status: "observed",
        observed_class: observedClass,
        action: enrollment,
        packages: []
      },
      myself: { visibleCount: 0, selected: false, enabled: false },
      injuries: { visibleCount: 0, value: "", enabled: false },
      packages: [],
      cancellation: { visibleCount: 0, accepted: false, enabled: false },
      submission: {
        book: { visibleCount: 0, enabled: false },
        waitlist: { visibleCount: 0, enabled: false }
      },
      confirmation: await readConfirmationCounts(page)
    };
  }

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
      observed_class: observedClass,
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

async function readLiveEnrollment(
  page: Page
): Promise<"already_booked" | "already_waitlisted" | undefined> {
  const booked = page
    .getByRole("button", { name: "Book Another Spot", exact: true })
    .filter({ visible: true });
  const waitlisted = page
    .getByRole("heading", { name: "You're on the waitlist", exact: true })
    .filter({ visible: true });
  const bookAction = accessibleActionButton(page, "book").filter({
    visible: true
  });
  const waitlistAction = accessibleActionButton(page, "waitlist").filter({
    visible: true
  });
  const [bookedCount, waitlistedCount, bookCount, waitlistCount] =
    await Promise.all([
      booked.count(),
      waitlisted.count(),
      bookAction.count(),
      waitlistAction.count()
    ]);
  if (
    bookedCount + waitlistedCount > 1 ||
    ((bookedCount === 1 || waitlistedCount === 1) &&
      bookCount + waitlistCount !== 0)
  ) {
    throw new Error("ambiguous enrollment");
  }
  if (waitlistedCount === 1) {
    if (!(await isMainLightDom(waitlisted))) {
      throw new Error("unsupported enrollment boundary");
    }
    return "already_waitlisted";
  }
  if (bookedCount === 0) return undefined;
  if (!(await isMainLightDom(booked))) {
    throw new Error("unsupported enrollment boundary");
  }
  const section = booked.locator("xpath=..");
  const details = section
    .getByRole("button", { name: "View Details", exact: true })
    .filter({ visible: true });
  await (await exactEnabledVisible(details)).click();
  const proof = section
    .getByText("You are Booked!", { exact: true })
    .filter({ visible: true });
  if ((await proof.count()) !== 1 || !(await isMainLightDom(proof))) {
    throw new Error("missing booking proof");
  }
  return "already_booked";
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
  timezone: string | undefined,
  now: Date
): Readonly<{ date: string; start: string; end: string; timezone: string }> {
  const match = value.match(
    /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ([1-9]|[12][0-9]|3[01]) • (0?[1-9]|1[0-2]):([0-5][0-9]) (AM|PM) - (0?[1-9]|1[0-2]):([0-5][0-9]) (AM|PM) ((?:[A-Z]{2,5}|GMT[+-](?:[0-9]|1[0-4])(?::[0-5][0-9])?))$/u
  );
  if (match === null) throw new Error("invalid class time");
  const to24Hour = (hour: string, minute: string, meridiem: string): string => {
    const numeric = (Number(hour) % 12) + (meridiem === "PM" ? 12 : 0);
    return `${String(numeric).padStart(2, "0")}:${minute}`;
  };
  const start = to24Hour(match[4]!, match[5]!, match[6]!);
  const end = to24Hour(match[7]!, match[8]!, match[9]!);
  const date = inferUpcomingDate(
    match[1]!,
    match[2]!,
    Number(match[3]!),
    timezone ?? "UTC",
    now
  );
  const displayedTimezone = match[10]!;
  if (
    timezone !== undefined &&
    !zoneNamesForLocalDateTime(date, start, timezone).has(displayedTimezone)
  ) {
    throw new Error("class timezone mismatch");
  }
  return { date, start, end, timezone: displayedTimezone };
}

function inferUpcomingDate(
  weekday: string,
  month: string,
  day: number,
  timezone: string,
  now: Date
): string {
  const monthNumber =
    [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec"
    ].indexOf(month) + 1;
  if (monthNumber === 0) throw new Error("invalid class date");
  const currentYear = Number(
    new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      timeZone: timezone
    }).format(now)
  );
  const candidates: ReadonlyArray<
    Readonly<{ date: string; distance: number }>
  > = [currentYear - 1, currentYear, currentYear + 1].flatMap((year) => {
    const candidate = `${year}-${String(monthNumber).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const instant = new Date(`${candidate}T12:00:00Z`);
    const prefix = new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
      timeZone: "UTC"
    }).format(instant);
    return prefix === `${weekday}, ${month} ${day}`
      ? [
          {
            date: candidate,
            distance: Math.abs(instant.getTime() - now.getTime())
          }
        ]
      : [];
  });
  const closest = [...candidates].sort(
    (left, right) => left.distance - right.distance
  )[0];
  if (closest === undefined) throw new Error("invalid class date");
  return closest.date;
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
  for (let quarterHours = -56; quarterHours <= 56; quarterHours += 1) {
    const parts = formatter.formatToParts(
      new Date(localAsUtc + quarterHours * 15 * 60 * 1000)
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
