import { readFile, writeFile } from "node:fs/promises";
import { URL } from "node:url";

import { chromium } from "playwright";

import { createBookingPage } from "../../dist/booking-page.js?built-e2e-real";
import { createCalendarPage } from "../../dist/calendar-page.js";
import {
  validateCalendarPageUrl,
  validateCheckoutUrl
} from "../../dist/url-policy.js";

const fixturePath = process.env.PILATES_BOOKER_E2E_FIXTURE;
if (fixturePath === undefined) {
  throw new Error("PILATES_BOOKER_E2E_FIXTURE is required");
}

export class BookingCheckoutNotSelectedError extends Error {
  code = "BOOKING_CHECKOUT_NOT_SELECTED";

  constructor() {
    super("Booking checkout was not selected.");
    this.name = "BookingCheckoutNotSelectedError";
  }
}

export function createBookingBrowser() {
  return async (_profileDir, input, use) => {
    const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
    const browser = await chromium.launch({ headless: true });
    let browserContexts = 0;
    let pages = 0;
    const context = await browser.newContext();
    browserContexts += 1;
    const page = await context.newPage();
    pages += 1;
    let calendarNavigations = 0;
    let checkoutNavigations = 0;
    let calendarWeekClicks = 0;
    let calendarCheckoutClicks = 0;
    let myselfSelections = 0;
    let injuryFills = 0;
    let packageSelections = 0;
    let cancellationAcceptances = 0;
    let submissions = 0;
    try {
      await context.route("https://app.arketa.co/**", async (route) => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname.endsWith("/calendar")) {
          calendarNavigations += 1;
          await route.fulfill({
            contentType: "text/html; charset=utf-8",
            body: fixture.calendar_html
          });
          return;
        }
        if (pathname.includes("/calendar/checkout/")) {
          checkoutNavigations += 1;
          await route.fulfill({
            contentType: "text/html; charset=utf-8",
            body: fixture.checkout_html ?? fixture.html
          });
          return;
        }
        await route.abort();
      });

      let checkoutUrl;
      let expectedClass;
      if (input.entry_mode === "calendar") {
        const calendarUrl = validateCalendarPageUrl(input.calendar_url);
        await page.goto(calendarUrl.href, { waitUntil: "domcontentloaded" });
        let selection;
        try {
          selection = await createCalendarPage(page, calendarUrl).select(input);
        } finally {
          calendarWeekClicks = Number(
            (await page
              .locator("body")
              .getAttribute("data-calendar-navigation-clicks")) ?? 0
          );
          calendarCheckoutClicks = Number(
            (await page
              .locator("body")
              .getAttribute("data-calendar-checkout-clicks")) ?? 0
          );
        }
        if (selection.status === "not_selected") {
          throw new BookingCheckoutNotSelectedError();
        }
        checkoutUrl = validateCheckoutUrl(selection.target.checkoutUrl).href;
        expectedClass = {
          name: selection.target.className,
          date: selection.target.classDate,
          start_time: selection.target.classTime
        };
        if (fixture.failure === "pre_submission") {
          throw new Error("Synthetic pre-submission browser failure.");
        }
      } else {
        checkoutUrl = validateCheckoutUrl(input.booking_url).href;
      }

      await page.goto(checkoutUrl, { waitUntil: "domcontentloaded" });
      const bookingPage = createBookingPage(page);
      return await use(
        {
          ...bookingPage,
          selectMyself: async () => {
            myselfSelections += 1;
            await bookingPage.selectMyself();
          },
          fillInjuriesIfEmpty: async (value) => {
            injuryFills += 1;
            await bookingPage.fillInjuriesIfEmpty(value);
          },
          selectPackage: async (row) => {
            packageSelections += 1;
            await bookingPage.selectPackage(row);
          },
          acceptCancellationPolicy: async () => {
            cancellationAcceptances += 1;
            await bookingPage.acceptCancellationPolicy();
          },
          submit: async (action) => {
            submissions += 1;
            await bookingPage.submit(action);
            if (fixture.failure === "post_submit") {
              throw new Error("Synthetic post-submit confirmation failure.");
            }
            const selector =
              action === "book"
                ? '[data-testid="confirmation-booked"]'
                : '[data-testid="confirmation-waitlisted"]';
            await page
              .locator(selector)
              .evaluate((element) => element.removeAttribute("hidden"));
          }
        },
        {
          checkoutUrl,
          ...(expectedClass === undefined ? {} : { expectedClass })
        }
      );
    } finally {
      const myself = page.getByLabel("Myself", { exact: true });
      const injuries = page.getByLabel(/^Do you have any injuries\?/u);
      const cancellation = page.getByLabel(
        "I agree to the Cancellation Policy",
        { exact: true }
      );
      const observation = {
        myself_selected:
          (await myself.count()) === 1 ? await myself.isChecked() : false,
        injuries_value:
          (await injuries.count()) === 1 ? await injuries.inputValue() : "",
        selected_package_rows: await page
          .locator('[data-testid="offering"]')
          .evaluateAll((offerings) =>
            offerings.flatMap((offering, row) =>
              offering.querySelector('input[type="radio"]:checked') === null
                ? []
                : [row]
            )
          ),
        cancellation_accepted:
          (await cancellation.count()) === 1
            ? await cancellation.isChecked()
            : false,
        submissions,
        ...(input.entry_mode === "checkout"
          ? {}
          : {
              browser_contexts: browserContexts,
              pages,
              calendar_navigations: calendarNavigations,
              checkout_navigations: checkoutNavigations,
              calendar_week_clicks: calendarWeekClicks,
              calendar_checkout_clicks: calendarCheckoutClicks,
              myself_selections: myselfSelections,
              injury_fills: injuryFills,
              package_selections: packageSelections,
              cancellation_acceptances: cancellationAcceptances
            })
      };
      await writeFile(
        fixture.observation_path,
        `${JSON.stringify(observation)}\n`,
        "utf8"
      );
      await page.close();
      await context.close();
      await browser.close();
    }
  };
}
