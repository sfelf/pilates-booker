import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, expect, test, vi } from "vitest";

import { createBookingPage, type BookingBrowser } from "../src/booking-page.js";
import { runCommand } from "../src/command.js";
import { bookingPageHtml } from "./fixtures/checkout.js";

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser.close();
});

test("runs a CLI-only dry inspection without persistence or form mutation", async () => {
  let submitted = false;
  let myselfSelected = true;
  let injuriesValue = "";
  const bookingBrowser: BookingBrowser = async (_profile, _url, use) => {
    const page = await browser.newPage();
    try {
      await page.setContent(
        bookingPageHtml({
          action: "book",
          myselfSelected: false
        })
      );
      const bookingPage = createBookingPage(page);
      const result = await use({
        ...bookingPage,
        submit: async (action) => {
          submitted = true;
          await bookingPage.submit(action);
        }
      });
      myselfSelected = await page
        .getByLabel("Myself", { exact: true })
        .isChecked();
      injuriesValue = await page
        .getByLabel(/^Do you have any injuries\?/u)
        .inputValue();
      return result;
    } finally {
      await page.close();
    }
  };
  const emitResult = vi.fn(async () => undefined);

  expect(
    await runCommand(
      [
        "--booking-url",
        "https://app.arketa.co/iframe/synthetic/calendar/checkout/e2e",
        "--allow-package",
        "Studio / 10-Class Pack",
        "--runtime",
        "/private/runtime",
        "--dry-run"
      ],
      {
        bookingBrowser,
        acquireLock: async () => ({
          release: async () => ({ released: true as const })
        }),
        emitResult
      }
    )
  ).toBe(0);

  expect(submitted).toBe(false);
  expect(myselfSelected).toBe(false);
  expect(injuriesValue).toBe("Synthetic existing answer");
  const bytes = (emitResult.mock.calls as unknown as [[string]])[0][0];
  expect(bytes.endsWith("\n")).toBe(true);
  expect(JSON.parse(bytes)).toMatchObject({
    schema_version: 2,
    outcome: "DRY_RUN",
    availability: "BOOKING_AVAILABLE",
    action_submitted: false,
    confirmation_verified: false
  });
});
