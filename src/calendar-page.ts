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

class CalendarPageError extends Error {
  readonly code = "CALENDAR_PAGE_UNAVAILABLE";

  constructor() {
    super("Calendar page could not be read.");
    this.name = "CalendarPageError";
  }
}

export function createCalendarPage(
  page: Page,
  calendarUrl: URL
): Readonly<{
  select(request: DiscoveryBookingInput): Promise<CalendarSelection>;
}> {
  return {
    select: async (request) => {
      const validatedCalendarUrl = assertCalendarIdentity(page, calendarUrl);
      if (
        validateCalendarPageUrl(request.calendar_url).href !==
        validatedCalendarUrl.href
      ) {
        throw new CalendarPageError();
      }
      let calendar = await readCalendarWeek(page, request.class_date);
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
          expectedWeekStart
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
    const nextControl = page.getByRole("button", {
      name: "Next week",
      exact: true
    });
    if (
      (await nextControl.count()) !== 1 ||
      !(await nextControl.isVisible()) ||
      !(await nextControl.isEnabled())
    ) {
      throw new CalendarPageError();
    }
    await nextControl.click();
    await page.waitForFunction((expectedStart) => {
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
      const headings = [
        ...document.querySelectorAll('h1[id="calendar-week-heading"]')
      ].filter(isVisible);
      return (
        headings.length === 1 &&
        (headings[0]?.textContent ?? "").replace(/\s+/gu, " ").trim() ===
          `Week of ${expectedStart}`
      );
    }, expectedWeekStart);
  } catch (error) {
    if (error instanceof CalendarPageError) throw error;
    throw new CalendarPageError();
  }
}

async function readCalendarWeek(
  page: Page,
  targetDate: string,
  expectedWeekStart?: string
): Promise<CalendarWeek> {
  try {
    await page.waitForFunction((expectedStart) => {
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
      const headings = [
        ...document.querySelectorAll('h1[id="calendar-week-heading"]')
      ].filter(isVisible);
      const headingMatch = /^Week of (\d{4}-\d{2}-\d{2})$/u.exec(
        (headings[0]?.textContent ?? "").replace(/\s+/gu, " ").trim()
      );
      const regions = [
        ...document.querySelectorAll('[role="region"][aria-label]')
      ].filter(
        (element) =>
          isVisible(element) &&
          /^\d{4}-\d{2}-\d{2}$/u.test(element.getAttribute("aria-label") ?? "")
      );
      if (
        headings.length !== 1 ||
        headingMatch === null ||
        regions.length !== 7
      ) {
        return false;
      }
      const weekStart = expectedStart ?? headingMatch[1];
      if (weekStart === undefined || headingMatch[1] !== weekStart)
        return false;
      const date = new Date(`${weekStart}T12:00:00.000Z`);
      if (Number.isNaN(date.getTime())) return false;
      return regions.every((region, offset) => {
        const expectedDate = new Date(date);
        expectedDate.setUTCDate(expectedDate.getUTCDate() + offset);
        return (
          region.getAttribute("aria-label") ===
          expectedDate.toISOString().slice(0, 10)
        );
      });
    }, expectedWeekStart);

    const snapshot = await page.evaluate((requestedDate) => {
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
      const rawText = (element: Element): string => element.textContent ?? "";
      const headings = [
        ...document.querySelectorAll('h1[id="calendar-week-heading"]')
      ].filter(isVisible);
      const heading = headings[0];
      const headingMatch = /^Week of (\d{4}-\d{2}-\d{2})$/u.exec(
        heading === undefined ? "" : visibleText(heading)
      );
      const regions = [
        ...document.querySelectorAll('[role="region"][aria-label]')
      ].filter(
        (element) =>
          isVisible(element) &&
          /^\d{4}-\d{2}-\d{2}$/u.test(element.getAttribute("aria-label") ?? "")
      );
      const dates = regions.map((region) => region.getAttribute("aria-label"));
      const targetRegion = regions.find(
        (region) => region.getAttribute("aria-label") === requestedDate
      );
      const classes =
        targetRegion === undefined
          ? []
          : [...targetRegion.querySelectorAll('article[aria-label="Class"]')]
              .filter(isVisible)
              .map((article) => {
                const names = [
                  ...article.querySelectorAll(":scope > h2")
                ].filter(isVisible);
                const times = [
                  ...article.querySelectorAll(":scope > time")
                ].filter(isVisible);
                const links = [
                  ...article.querySelectorAll(":scope > a[href]")
                ].filter(isVisible);
                return {
                  className:
                    names.length === 1 && names[0] !== undefined
                      ? rawText(names[0])
                      : undefined,
                  time:
                    times.length === 1 && times[0] !== undefined
                      ? visibleText(times[0])
                      : undefined,
                  hrefs: links.flatMap((link) => {
                    const href = link.getAttribute("href");
                    return href === null ? [] : [href];
                  })
                };
              });
      return { headingStart: headingMatch?.[1], dates, classes };
    }, targetDate);

    const dates = snapshot.dates.filter(
      (date): date is string => date !== null && isIsoDate(date)
    );
    if (
      snapshot.headingStart === undefined ||
      !isIsoDate(snapshot.headingStart) ||
      dates.length !== 7 ||
      new Set(dates).size !== 7 ||
      !hasConsecutiveDates(snapshot.headingStart, dates)
    ) {
      throw new CalendarPageError();
    }

    const targetClasses = snapshot.classes.map((candidate) => {
      if (candidate.className === undefined || candidate.time === undefined) {
        throw new CalendarPageError();
      }
      if (projectSafeText(candidate.className) !== candidate.className) {
        throw new CalendarPageError();
      }
      const classTime = parseCalendarTime(candidate.time);
      if (classTime === undefined) throw new CalendarPageError();
      return {
        className: candidate.className,
        classTime,
        hrefs: candidate.hrefs
      };
    });
    return { startDate: snapshot.headingStart, dates, targetClasses };
  } catch (error) {
    if (error instanceof CalendarPageError) throw error;
    throw new CalendarPageError();
  }
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

function hasConsecutiveDates(
  startDate: string,
  dates: readonly string[]
): boolean {
  return dates.every((date, index) => date === addDays(startDate, index));
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
