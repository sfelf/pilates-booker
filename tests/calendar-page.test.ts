import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createCalendarPage } from "../src/calendar-page.js";
import type { DiscoveryBookingInput } from "../src/contracts.js";
import {
  calendarPageHtml,
  type CalendarFixtureOptions
} from "./fixtures/calendar.js";

const calendarUrl = new URL(
  "https://app.arketa.co/iframe/synthetic-studio/calendar"
);
const checkoutUrl =
  "https://app.arketa.co/iframe/synthetic-studio/calendar/checkout/SYNTHETIC_CLASS";

const request: DiscoveryBookingInput = {
  entry_mode: "calendar",
  calendar_url: calendarUrl.href,
  class_name: "Reformer – Début ✨",
  class_date: "2026-09-09",
  class_time: "09:30",
  allowed_packages: ["Synthetic Pack"],
  permitted_actions: ["book", "waitlist"],
  dry_run: true
};

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser.close();
});

async function syntheticPage(options: CalendarFixtureOptions): Promise<Page> {
  const page = await browser.newPage();
  await page.setContent(calendarPageHtml(options));
  return page;
}

async function counters(page: Page) {
  return page.locator("body").evaluate((body) => ({
    navigation: Number(body.dataset.calendarNavigationClicks),
    checkout: Number(body.dataset.calendarCheckoutClicks)
  }));
}

const brokenNextWeekFixtures: readonly (readonly [
  string,
  CalendarFixtureOptions
])[] = [
  ["missing", { nextControl: "missing" }],
  ["duplicate", { nextControl: "duplicate" }],
  ["disabled", { nextControl: "disabled" }],
  ["unchanged", { navigation: "unchanged" }],
  ["partially hydrated", { incompleteWeeks: [1] }]
];

describe("CalendarPage read-only discovery boundary", () => {
  it("selects one exact current-week class without activating its checkout link", async () => {
    const page = await syntheticPage({
      classes: [
        {
          name: "Reformer – Début ✨",
          date: "2026-09-09",
          time: "9:30 AM",
          href: "calendar/checkout/SYNTHETIC_CLASS"
        }
      ]
    });

    await expect(
      createCalendarPage(page, calendarUrl).select(request)
    ).resolves.toEqual({
      status: "selected",
      target: {
        checkoutUrl,
        className: "Reformer – Début ✨",
        classDate: "2026-09-09",
        classTime: "09:30"
      }
    });
    expect(await counters(page)).toEqual({ navigation: 0, checkout: 0 });
    await page.close();
  });

  it("matches canonical class names while preserving the original case, punctuation, and Unicode", async () => {
    const page = await syntheticPage({
      classes: [
        {
          name: "  ⭐  Reformer   – Début ✨  ⭐ ",
          date: "2026-09-09",
          time: "9:30 AM",
          href: "calendar/checkout/SYNTHETIC_CLASS"
        }
      ]
    });

    await expect(
      createCalendarPage(page, calendarUrl).select(request)
    ).resolves.toEqual({
      status: "selected",
      target: {
        checkoutUrl,
        className: "  ⭐  Reformer   – Début ✨  ⭐ ",
        classDate: "2026-09-09",
        classTime: "09:30"
      }
    });
    expect(await counters(page)).toEqual({ navigation: 0, checkout: 0 });
    await page.close();
  });

  it.each([
    {
      label: "same name at a different time",
      classes: [
        {
          name: "Reformer – Début ✨",
          date: "2026-09-09",
          time: "10:30 AM",
          href: "calendar/checkout/OTHER_TIME"
        }
      ]
    },
    {
      label: "different name at the same time",
      classes: [
        {
          name: "Mat Flow",
          date: "2026-09-09",
          time: "9:30 AM",
          href: "calendar/checkout/OTHER_NAME"
        }
      ]
    },
    {
      label: "same class outside the requested date region",
      classes: [
        {
          name: "Reformer – Début ✨",
          date: "2026-09-10",
          time: "9:30 AM",
          href: "calendar/checkout/OTHER_DATE"
        }
      ]
    }
  ])("returns evidence-free non-selection for $label", async ({ classes }) => {
    const page = await syntheticPage({ classes });

    await expect(
      createCalendarPage(page, calendarUrl).select(request)
    ).resolves.toEqual({
      status: "not_selected"
    });
    expect(await counters(page)).toEqual({ navigation: 0, checkout: 0 });
    await page.close();
  });

  it("does not select multiple exact class matches", async () => {
    const page = await syntheticPage({
      classes: [
        {
          name: "Reformer – Début ✨",
          date: "2026-09-09",
          time: "9:30 AM",
          href: "calendar/checkout/FIRST"
        },
        {
          name: "Reformer – Début ✨",
          date: "2026-09-09",
          time: "9:30 AM",
          href: "calendar/checkout/SECOND"
        }
      ]
    });

    await expect(
      createCalendarPage(page, calendarUrl).select(request)
    ).resolves.toEqual({
      status: "not_selected"
    });
    expect(await counters(page)).toEqual({ navigation: 0, checkout: 0 });
    await page.close();
  });

  it.each([
    { label: "missing", href: undefined, linkCount: undefined },
    {
      label: "duplicate",
      href: "calendar/checkout/SYNTHETIC_CLASS",
      linkCount: 2
    },
    {
      label: "unsafe",
      href: "calendar/checkout/SYNTHETIC_CLASS?mode=book",
      linkCount: undefined
    }
  ])(
    "rejects a $label checkout link without exposing it",
    async ({ href, linkCount }) => {
      const page = await syntheticPage({
        classes: [
          {
            name: "Reformer – Début ✨",
            date: "2026-09-09",
            time: "9:30 AM",
            ...(href === undefined ? {} : { href }),
            ...(linkCount === undefined ? {} : { linkCount })
          }
        ]
      });

      await expect(
        createCalendarPage(page, calendarUrl).select(request)
      ).resolves.toEqual({
        status: "not_selected"
      });
      expect(await counters(page)).toEqual({ navigation: 0, checkout: 0 });
      await page.close();
    }
  );
});

describe("CalendarPage bounded weekly navigation", () => {
  it.each([
    [1, "2026-09-16", "2026-09-14"],
    [4, "2026-10-07", "2026-10-05"],
    [12, "2026-12-02", "2026-11-30"]
  ])(
    "moves forward exactly %i week(s) to select an in-horizon class",
    async (offset, date, expectedWeekStart) => {
      const page = await syntheticPage({
        classes: [
          {
            name: "Reformer – Début ✨",
            date,
            time: "9:30 AM",
            href: "calendar/checkout/SYNTHETIC_CLASS"
          }
        ]
      });

      await expect(
        createCalendarPage(page, calendarUrl).select({
          ...request,
          class_date: date
        })
      ).resolves.toEqual({
        status: "selected",
        target: {
          checkoutUrl,
          className: "Reformer – Début ✨",
          classDate: date,
          classTime: "09:30"
        }
      });
      expect(await counters(page)).toEqual({ navigation: offset, checkout: 0 });
      expect(
        await page
          .getByRole("heading", {
            name: `Week of ${expectedWeekStart}`,
            exact: true
          })
          .count()
      ).toBe(1);
      await page.close();
    }
  );

  it("navigates across a year boundary using displayed calendar weeks", async () => {
    const page = await syntheticPage({
      startWeek: "2026-12-28",
      classes: [
        {
          name: "Reformer – Début ✨",
          date: "2027-01-06",
          time: "9:30 AM",
          href: "calendar/checkout/SYNTHETIC_CLASS"
        }
      ]
    });

    await expect(
      createCalendarPage(page, calendarUrl).select({
        ...request,
        class_date: "2027-01-06"
      })
    ).resolves.toMatchObject({ status: "selected" });
    expect(await counters(page)).toEqual({ navigation: 1, checkout: 0 });
    expect(
      await page
        .getByRole("heading", {
          name: "Week of 2027-01-04",
          exact: true
        })
        .count()
    ).toBe(1);
    await page.close();
  });

  it.each([
    ["an earlier date", "2026-09-02"],
    ["a date beyond the twelfth following week", "2026-12-09"]
  ])("does not traverse for %s", async (_label, classDate) => {
    const page = await syntheticPage({
      classes: [
        {
          name: "Reformer – Début ✨",
          date: classDate,
          time: "9:30 AM",
          href: "calendar/checkout/SYNTHETIC_CLASS"
        }
      ]
    });

    await expect(
      createCalendarPage(page, calendarUrl).select({
        ...request,
        class_date: classDate
      })
    ).resolves.toEqual({ status: "not_selected" });
    expect(await counters(page)).toEqual({ navigation: 0, checkout: 0 });
    expect(
      await page
        .getByRole("heading", { name: "Week of 2026-09-07", exact: true })
        .count()
    ).toBe(1);
    await page.close();
  });

  it.each(brokenNextWeekFixtures)(
    "fails closed when the next calendar week is %s",
    async (_label, options) => {
      const page = await syntheticPage({
        ...options,
        classes: [
          {
            name: "Reformer – Début ✨",
            date: "2026-09-16",
            time: "9:30 AM",
            href: "calendar/checkout/SYNTHETIC_CLASS"
          }
        ]
      });
      page.setDefaultTimeout(250);

      await expect(
        createCalendarPage(page, calendarUrl).select({
          ...request,
          class_date: "2026-09-16"
        })
      ).rejects.toThrow("Calendar page could not be read.");
      expect((await counters(page)).checkout).toBe(0);
      if (
        options.navigation === "unchanged" ||
        options.incompleteWeeks !== undefined
      ) {
        expect((await counters(page)).navigation).toBe(1);
      } else {
        expect((await counters(page)).navigation).toBe(0);
      }
      await page.close();
    }
  );

  it("fails closed when the initial calendar never becomes ready", async () => {
    const page = await syntheticPage({ hydrateAfterMs: 500 });
    page.setDefaultTimeout(100);

    await expect(
      createCalendarPage(page, calendarUrl).select(request)
    ).rejects.toThrow("Calendar page could not be read.");
    expect(await counters(page)).toEqual({ navigation: 0, checkout: 0 });
    await page.close();
  });
});
