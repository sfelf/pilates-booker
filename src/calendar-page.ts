import type { Page } from "playwright";

import type { DiscoveryBookingInput } from "./contracts.js";
import { normalizePackageNameForComparison } from "./package-selection.js";
import { projectSafeText } from "./safe-text.js";
import {
  validateCalendarPageUrl,
  validateCheckoutUrlForCalendar
} from "./url-policy.js";

export type DiscoveryTarget = Readonly<{
  checkoutUrl: string;
  className: string;
  classDate: string;
  classTime: string;
}>;

export type CalendarSelection =
  | Readonly<{ status: "selected"; target: DiscoveryTarget }>
  | Readonly<{ status: "not_selected" }>;

type CalendarClass = Readonly<{
  className: string;
  classTime: string;
  hrefs: readonly string[];
}>;

type CalendarWeek = Readonly<{
  startDate: string;
  dates: readonly string[];
  targetClasses: readonly CalendarClass[];
}>;

type CalendarPageOptions = Readonly<{ now?: Date }>;

const calendarSettleTimeoutMs = 10_000;

class CalendarPageError extends Error {
  readonly code = "CALENDAR_PAGE_UNAVAILABLE";

  constructor() {
    super("Calendar page could not be read.");
    this.name = "CalendarPageError";
  }
}

export function createCalendarPage(
  page: Page,
  calendarUrl: URL,
  options: CalendarPageOptions = {}
): Readonly<{
  select(request: DiscoveryBookingInput): Promise<CalendarSelection>;
}> {
  return {
    select: async (request) => {
      const now = options.now ?? new Date();
      const validatedCalendarUrl = assertCalendarIdentity(page, calendarUrl);
      if (
        validateCalendarPageUrl(request.calendar_url).href !==
        validatedCalendarUrl.href
      ) {
        throw new CalendarPageError();
      }
      let calendar = await readCalendarWeek(
        page,
        request.class_date,
        undefined,
        now
      );
      assertCalendarIdentity(page, validatedCalendarUrl);
      const targetWeekOffset = calculateWeekOffset(
        calendar.startDate,
        request.class_date
      );
      if (
        targetWeekOffset === undefined ||
        targetWeekOffset < 0 ||
        targetWeekOffset > 12
      ) {
        return { status: "not_selected" };
      }

      for (let offset = 0; offset < targetWeekOffset; offset += 1) {
        const expectedWeekStart = addDays(calendar.startDate, 7);
        await advanceToNextWeek(page, expectedWeekStart);
        assertCalendarIdentity(page, validatedCalendarUrl);
        calendar = await readCalendarWeek(
          page,
          request.class_date,
          expectedWeekStart,
          now,
          offset === targetWeekOffset - 1 ? 750 : 100
        );
        assertCalendarIdentity(page, validatedCalendarUrl);
        if (calendar.startDate !== expectedWeekStart) {
          throw new CalendarPageError();
        }
      }

      if (!calendar.dates.includes(request.class_date)) {
        throw new CalendarPageError();
      }

      const matches = calendar.targetClasses.filter(
        (candidate) =>
          candidate.classTime === request.class_time &&
          normalizePackageNameForComparison(candidate.className) ===
            normalizePackageNameForComparison(request.class_name)
      );
      if (matches.length !== 1) return { status: "not_selected" };

      const match = matches[0];
      if (match === undefined) {
        return { status: "not_selected" };
      }

      const checkoutUrls = match.hrefs.flatMap((href) => {
        try {
          return [validateCheckoutUrlForCalendar(href, validatedCalendarUrl)];
        } catch {
          return [];
        }
      });
      if (checkoutUrls.length !== 1 || checkoutUrls[0] === undefined) {
        return { status: "not_selected" };
      }

      try {
        return {
          status: "selected",
          target: {
            checkoutUrl: checkoutUrls[0].href,
            className: match.className,
            classDate: request.class_date,
            classTime: match.classTime
          }
        };
      } catch {
        return { status: "not_selected" };
      }
    }
  };
}

function assertCalendarIdentity(page: Page, calendarUrl: URL): URL {
  try {
    const validatedCalendarUrl = validateCalendarPageUrl(calendarUrl.href);
    if (page.url() !== validatedCalendarUrl.href) {
      throw new CalendarPageError();
    }
    return validatedCalendarUrl;
  } catch (error) {
    if (error instanceof CalendarPageError) throw error;
    throw new CalendarPageError();
  }
}

async function advanceToNextWeek(
  page: Page,
  expectedWeekStart: string
): Promise<void> {
  try {
    const nextControl = page.locator(
      "div.week-range__meta + div.week-range__arrow"
    );
    const duplicateNextControl = page.locator(
      "div.week-range__meta + div.week-range__arrow + div.week-range__arrow"
    );
    if (
      (await nextControl.count()) !== 1 ||
      (await duplicateNextControl.count()) !== 0 ||
      !(await nextControl.isVisible()) ||
      !(await nextControl.isEnabled()) ||
      (await nextControl.evaluate((element) =>
        element.classList.contains("week-range--disabled")
      ))
    ) {
      throw new CalendarPageError();
    }
    await nextControl.click();
    await page.waitForFunction((expectedRange) => {
      const isVisible = (element: Element): element is HTMLElement => {
        if (!(element instanceof HTMLElement)) return false;
        const style = getComputedStyle(element);
        return (
          !element.hidden &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          element.getClientRects().length > 0
        );
      };
      const ranges = [
        ...document.querySelectorAll("div.week-range__meta")
      ].filter(isVisible);
      return (
        ranges.length === 1 &&
        (ranges[0]?.textContent ?? "").replace(/\s+/gu, " ").trim() ===
          expectedRange
      );
    }, formatWeekRange(expectedWeekStart));
  } catch (error) {
    if (error instanceof CalendarPageError) throw error;
    throw new CalendarPageError();
  }
}

async function readCalendarWeek(
  page: Page,
  targetDate: string,
  expectedWeekStart: string | undefined,
  now: Date = new Date(),
  quietMs = 750
): Promise<CalendarWeek> {
  try {
    const expectedRange =
      expectedWeekStart === undefined
        ? undefined
        : formatWeekRange(expectedWeekStart);
    const expectedLabels =
      expectedWeekStart === undefined
        ? undefined
        : Array.from({ length: 7 }, (_, index) =>
            formatDateColumnLabel(addDays(expectedWeekStart, index))
          );
    await page.waitForFunction(
      ({ range: expected, labels }) => {
        const isVisible = (element: Element): element is HTMLElement => {
          if (!(element instanceof HTMLElement)) return false;
          const style = getComputedStyle(element);
          return (
            !element.hidden &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            element.getClientRects().length > 0
          );
        };
        const ranges = [
          ...document.querySelectorAll("div.week-range__meta")
        ].filter(isVisible);
        const columns = [
          ...document.querySelectorAll(
            "section.calendar-view__column[aria-label]"
          )
        ].filter(isVisible);
        const loading = [
          ...document.querySelectorAll(".spinner-border")
        ].filter(isVisible);
        const range =
          ranges.length === 1
            ? (ranges[0]?.textContent ?? "").replace(/\s+/gu, " ").trim()
            : "";
        return (
          columns.length === 7 &&
          loading.length === 0 &&
          (expected === undefined ? range.length > 0 : range === expected) &&
          (labels === undefined ||
            columns.every(
              (column, index) =>
                column.getAttribute("aria-label") === labels[index]
            ))
        );
      },
      { range: expectedRange, labels: expectedLabels }
    );
    if (!(await waitForCalendarSettled(page, quietMs))) {
      throw new CalendarPageError();
    }

    const snapshot = await page.evaluate((requestedLabel) => {
      const isVisible = (element: Element): element is HTMLElement => {
        if (!(element instanceof HTMLElement)) return false;
        const style = getComputedStyle(element);
        return (
          !element.hidden &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          element.getClientRects().length > 0
        );
      };
      const visibleText = (element: Element): string =>
        (element.textContent ?? "").replace(/\s+/gu, " ").trim();
      const ranges = [
        ...document.querySelectorAll("div.week-range__meta")
      ].filter(isVisible);
      const columns = [
        ...document.querySelectorAll(
          "section.calendar-view__column[aria-label]"
        )
      ].filter(isVisible);
      const labels = columns.map((column) => column.getAttribute("aria-label"));
      const targetColumn = columns.find(
        (column) => column.getAttribute("aria-label") === requestedLabel
      );
      const classes =
        targetColumn === undefined
          ? []
          : [
              ...targetColumn.querySelectorAll(
                "article.calendar-view__cell[aria-label]"
              )
            ]
              .filter(isVisible)
              .map((article) => {
                const links = [...article.querySelectorAll("a[href]")];
                return {
                  label: article.getAttribute("aria-label") ?? "",
                  hrefs: links.flatMap((link) => {
                    const href = link.getAttribute("href");
                    return href === null ? [] : [href];
                  })
                };
              });
      return {
        range: ranges.length === 1 ? visibleText(ranges[0]!) : undefined,
        labels,
        classes
      };
    }, formatDateColumnLabel(targetDate));

    const startDate =
      expectedWeekStart ??
      (snapshot.range === undefined
        ? undefined
        : parseWeekRange(snapshot.range, now));
    const labels = snapshot.labels.filter(
      (label): label is string => label !== null
    );
    if (
      startDate === undefined ||
      snapshot.range !== formatWeekRange(startDate) ||
      labels.length !== 7 ||
      new Set(labels).size !== 7 ||
      !hasConsecutiveDateLabels(startDate, labels)
    ) {
      throw new CalendarPageError();
    }

    const targetClasses = snapshot.classes.map((candidate) => {
      const separator = candidate.label.lastIndexOf(" — ");
      if (separator <= 0) {
        throw new CalendarPageError();
      }
      const className = candidate.label.slice(0, separator);
      const renderedTime = candidate.label.slice(separator + 3);
      if (projectSafeText(className) !== className) {
        throw new CalendarPageError();
      }
      const classTime = parseCalendarTime(renderedTime);
      if (classTime === undefined) throw new CalendarPageError();
      return {
        className,
        classTime,
        hrefs: candidate.hrefs
      };
    });
    const dates = Array.from({ length: 7 }, (_, index) =>
      addDays(startDate, index)
    );
    return { startDate, dates, targetClasses };
  } catch (error) {
    if (error instanceof CalendarPageError) throw error;
    throw new CalendarPageError();
  }
}

async function waitForCalendarSettled(
  page: Page,
  quietMs = 750
): Promise<boolean> {
  return page.evaluate(
    ({ quietMs, timeoutMs }) =>
      new Promise<boolean>((resolve) => {
        const root = document.body;
        if (root === null) {
          resolve(false);
          return;
        }
        let quietTimer: ReturnType<typeof setTimeout> | undefined;
        const finish = (settled: boolean) => {
          observer.disconnect();
          if (quietTimer !== undefined) clearTimeout(quietTimer);
          clearTimeout(deadline);
          resolve(settled);
        };
        const check = () => {
          if (quietTimer !== undefined) clearTimeout(quietTimer);
          if (document.querySelector(".spinner-border") !== null) return;
          quietTimer = setTimeout(() => finish(true), quietMs);
        };
        const observer = new MutationObserver(check);
        const deadline = setTimeout(() => finish(false), timeoutMs);
        observer.observe(root, { childList: true, subtree: true });
        check();
      }),
    { quietMs, timeoutMs: calendarSettleTimeoutMs }
  );
}

function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (match === null) return false;
  const date = new Date(`${value}T12:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) &&
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() + 1 === Number(match[2]) &&
    date.getUTCDate() === Number(match[3])
  );
}

function hasConsecutiveDateLabels(
  startDate: string,
  labels: readonly string[]
): boolean {
  return labels.every(
    (label, index) => label === formatDateColumnLabel(addDays(startDate, index))
  );
}

const months = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
] as const;

function formatWeekRange(startDate: string): string {
  const start = new Date(`${startDate}T12:00:00.000Z`);
  const end = new Date(`${addDays(startDate, 6)}T12:00:00.000Z`);
  return `${months[start.getUTCMonth()]} ${start.getUTCDate()} — ${months[end.getUTCMonth()]} ${end.getUTCDate()}`;
}

function formatDateColumnLabel(isoDate: string): string {
  const date = new Date(`${isoDate}T12:00:00.000Z`);
  const weekday = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday"
  ][date.getUTCDay()];
  const day = date.getUTCDate();
  const suffix =
    day % 100 >= 11 && day % 100 <= 13
      ? "th"
      : (({ 1: "st", 2: "nd", 3: "rd" } as const)[(day % 10) as 1 | 2 | 3] ??
        "th");
  return `${weekday} ${months[date.getUTCMonth()]?.slice(0, 3)} ${day}${suffix}`;
}

function parseWeekRange(value: string, now: Date): string | undefined {
  const match =
    /^(January|February|March|April|May|June|July|August|September|October|November|December) ([1-9]|[12][0-9]|3[01]) — (January|February|March|April|May|June|July|August|September|October|November|December) ([1-9]|[12][0-9]|3[01])$/u.exec(
      value
    );
  if (match === null) return undefined;
  const startMonth = months.indexOf(match[1] as (typeof months)[number]);
  const endMonth = months.indexOf(match[3] as (typeof months)[number]);
  const nowTime = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    12
  );
  const candidates = [-1, 0, 1].flatMap((yearOffset) => {
    const year = now.getUTCFullYear() + yearOffset;
    const start = new Date(Date.UTC(year, startMonth, Number(match[2]), 12));
    if (
      start.getUTCMonth() !== startMonth ||
      start.getUTCDate() !== Number(match[2])
    ) {
      return [];
    }
    const isoStart = start.toISOString().slice(0, 10);
    const end = new Date(`${addDays(isoStart, 6)}T12:00:00.000Z`);
    if (
      end.getUTCMonth() !== endMonth ||
      end.getUTCDate() !== Number(match[4])
    ) {
      return [];
    }
    return [
      {
        isoStart,
        distance: Math.abs(start.getTime() - nowTime)
      }
    ];
  });
  candidates.sort((left, right) => left.distance - right.distance);
  const nearest = candidates[0];
  return nearest?.isoStart;
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function calculateWeekOffset(
  currentWeekStart: string,
  targetDate: string
): number | undefined {
  if (!isIsoDate(targetDate)) return undefined;
  const currentTime = new Date(`${currentWeekStart}T12:00:00.000Z`).getTime();
  const targetTime = new Date(`${targetDate}T12:00:00.000Z`).getTime();
  const dayOffset = (targetTime - currentTime) / 86_400_000;
  return Number.isInteger(dayOffset) ? Math.floor(dayOffset / 7) : undefined;
}

function parseCalendarTime(value: string): string | undefined {
  const twelveHour = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/iu.exec(value);
  if (twelveHour !== null) {
    const hour = Number(twelveHour[1]);
    const minute = Number(twelveHour[2]);
    const period = twelveHour[3]?.toUpperCase();
    if (hour < 1 || hour > 12 || minute > 59 || period === undefined) {
      return undefined;
    }
    const hour24 = (hour % 12) + (period === "PM" ? 12 : 0);
    return `${String(hour24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  const twentyFourHour = /^([01]\d|2[0-3]):([0-5]\d)$/u.exec(value);
  return twentyFourHour === null ? undefined : value;
}
