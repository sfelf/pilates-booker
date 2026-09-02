import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { createBookingPage, type BookingBrowser } from "../src/booking-page.js";
import { runCommand } from "../src/command.js";
import type { BookingResult } from "../src/contracts.js";
import { validateResult } from "../src/result-validator.js";
import { bookingPageHtml } from "./fixtures/checkout.js";

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser.close();
});

const checkoutUrl =
  "https://app.arketa.co/iframe/synthetic/calendar/checkout/e2e";
const observedClass = {
  name: "Reformer – Début ✨",
  instructor: "Ana O’Neil",
  date: "2026-09-01",
  start_time: "09:30",
  end_time: "10:20",
  timezone: "America/Los_Angeles"
} as const;
type Scenario = Readonly<{
  name: string;
  action: "book" | "waitlist" | "already_booked" | "already_waitlisted";
  dryRun: boolean;
  outcome: BookingResult["outcome"];
  availability?: "BOOKING_AVAILABLE" | "WAITLIST_AVAILABLE";
  submitted: boolean;
  confirmed: boolean;
}>;
const scenarios: readonly Scenario[] = [
  {
    name: "confirmed booking",
    action: "book",
    dryRun: false,
    outcome: "BOOKED",
    submitted: true,
    confirmed: true
  },
  {
    name: "confirmed waitlist",
    action: "waitlist",
    dryRun: false,
    outcome: "WAITLISTED",
    submitted: true,
    confirmed: true
  },
  {
    name: "actionable booking dry run",
    action: "book",
    dryRun: true,
    outcome: "DRY_RUN",
    availability: "BOOKING_AVAILABLE",
    submitted: false,
    confirmed: false
  },
  {
    name: "actionable waitlist dry run",
    action: "waitlist",
    dryRun: true,
    outcome: "DRY_RUN",
    availability: "WAITLIST_AVAILABLE",
    submitted: false,
    confirmed: false
  },
  {
    name: "authoritative existing booking",
    action: "already_booked",
    dryRun: false,
    outcome: "ALREADY_BOOKED",
    submitted: false,
    confirmed: true
  },
  {
    name: "authoritative existing waitlist",
    action: "already_waitlisted",
    dryRun: false,
    outcome: "ALREADY_WAITLISTED",
    submitted: false,
    confirmed: true
  }
];

describe.each(scenarios)("public command: $name", (scenario) => {
  test("emits one complete schema-v2 result with bounded mutation", async () => {
    let submissions = 0;
    let myselfSelected = false;
    let injuriesValue = "";
    const bookingBrowser: BookingBrowser = async (_profile, _url, use) => {
      const page = await browser.newPage();
      try {
        await page.setContent(
          bookingPageHtml({ action: scenario.action, myselfSelected: false })
        );
        const bookingPage = createBookingPage(page);
        const value = await use({
          ...bookingPage,
          submit: async (action) => {
            submissions += 1;
            await bookingPage.submit(action);
            const selector =
              action === "book"
                ? '[data-testid="confirmation-booked"]'
                : '[data-testid="confirmation-waitlisted"]';
            await page
              .locator(selector)
              .evaluate((element) => element.removeAttribute("hidden"));
          }
        });
        myselfSelected = await page
          .getByLabel("Myself", { exact: true })
          .isChecked();
        injuriesValue = await page
          .getByLabel(/^Do you have any injuries\?/u)
          .inputValue();
        return value;
      } finally {
        await page.close();
      }
    };
    const emitResult = vi.fn(async () => undefined);
    const runtime = await mkdtemp(join(tmpdir(), "pilates-e2e-"));
    const argv = [
      "--booking-url",
      checkoutUrl,
      "--allow-package",
      "Studio / 10-Class Pack",
      "--runtime",
      runtime,
      ...(scenario.dryRun ? ["--dry-run"] : [])
    ];
    expect(await runCommand(argv, { bookingBrowser, emitResult })).toBe(0);
    expect(emitResult).toHaveBeenCalledOnce();
    const bytes = (emitResult.mock.calls as unknown as [[string]])[0][0];
    expect(bytes).toBe(`${JSON.stringify(JSON.parse(bytes))}\n`);
    const result = JSON.parse(bytes) as BookingResult & Record<string, unknown>;
    expect(validateResult(result)).toBe(true);
    expect(result).toMatchObject({
      schema_version: 2,
      outcome: scenario.outcome,
      action_submitted: scenario.submitted,
      confirmation_verified: scenario.confirmed,
      observed_class: observedClass
    });
    expect(result.availability).toBe(scenario.availability);
    expect(result).not.toHaveProperty("request_id");
    expect(result).not.toHaveProperty("exact_class_match");
    expect(submissions).toBe(scenario.submitted ? 1 : 0);
    if (scenario.dryRun) {
      expect(myselfSelected).toBe(false);
      expect(injuriesValue).toBe("Synthetic existing answer");
    }
    expect(
      (await readdir(runtime)).every(
        (name) => !["journals", "results"].includes(name)
      )
    ).toBe(true);
  });
});

test("debug is opt-in and writes only the bounded runtime log", async () => {
  const runtime = await mkdtemp(join(tmpdir(), "pilates-debug-e2e-"));
  const bookingBrowser: BookingBrowser = async (_profile, _url, use) => {
    const page = await browser.newPage();
    try {
      await page.setContent(bookingPageHtml({ action: "already_booked" }));
      return await use(createBookingPage(page));
    } finally {
      await page.close();
    }
  };
  const base = [
    "--booking-url",
    checkoutUrl,
    "--allow-package",
    "Studio / 10-Class Pack",
    "--runtime",
    runtime
  ];
  expect(
    await runCommand(base, {
      bookingBrowser,
      emitResult: async () => undefined
    })
  ).toBe(0);
  expect(await readdir(runtime)).not.toContain("pilates-booker.log");
  expect(
    await runCommand([...base, "--debug"], {
      bookingBrowser,
      emitResult: async () => undefined
    })
  ).toBe(0);
  const records = (await readFile(join(runtime, "pilates-booker.log"), "utf8"))
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(records[0]).toMatchObject({
    event: "command.started",
    data: { arguments: { booking_url: checkoutUrl, debug: true } }
  });
  expect(records.at(-1)).toMatchObject({
    event: "response.emitted",
    response_emitted: true
  });
  expect(await readdir(runtime)).not.toContain("journals");
  expect(await readdir(runtime)).not.toContain("results");
});
