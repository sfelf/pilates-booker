import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { createBookingPage, type BookingBrowser } from "../src/booking-page.js";
import { productionCommandDependencies, runCommand } from "../src/command.js";
import type { BookingRequest } from "../src/contracts.js";
import { bookingPageHtml } from "./fixtures/checkout.js";

const requestIdOne = "00000000-0000-4000-8000-000000000701";
const requestIdTwo = "00000000-0000-4000-8000-000000000702";
const expectedClass = {
  name: "Reformer – Début ✨",
  date: "2026-09-01",
  start_time: "09:30",
  timezone: "America/Los_Angeles"
} as const;

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser.close();
});

const request = (requestId: string): BookingRequest => ({
  schema_version: 1,
  request_id: requestId,
  booking_url:
    "https://app.arketa.co/iframe/example/calendar/checkout/FAKE_CHECKOUT_ID",
  expected_class: expectedClass,
  reserve_for: "myself",
  permitted_actions: ["book", "waitlist"],
  policy_version: "2030-01-01",
  allow_monetary_charge: false,
  dry_run: true
});

describe("direct-command synthetic checkout", () => {
  test("keeps dry runs non-mutating across two UUIDs and recovers a repeated UUID", async () => {
    const privateRuntime = await mkdtemp(
      join(tmpdir(), "pilates-e2e-runtime-")
    );
    const externalConfig = await mkdtemp(join(tmpdir(), "pilates-e2e-config-"));
    const policyPath = join(externalConfig, "policy.json");
    const firstRequestPath = join(externalConfig, "request-one.json");
    const secondRequestPath = join(externalConfig, "request-two.json");
    await writeFile(
      policyPath,
      JSON.stringify({
        schema_version: 1,
        policy_version: "2030-01-01",
        allowed_packages: ["Studio / 10-Class Pack"]
      }),
      "utf8"
    );
    await writeFile(
      firstRequestPath,
      JSON.stringify(request(requestIdOne)),
      "utf8"
    );
    await writeFile(
      secondRequestPath,
      JSON.stringify(request(requestIdTwo)),
      "utf8"
    );

    const observedProfiles: string[] = [];
    let browserInvocations = 0;
    let mutationObserved = false;
    const localCheckout: BookingBrowser = async (profileDir, _url, use) => {
      browserInvocations += 1;
      observedProfiles.push(profileDir);
      const page = await browser.newPage();
      await page.setContent(bookingPageHtml());
      const before = await page
        .locator("body")
        .evaluate((body) => body.innerHTML);
      try {
        return await use(createBookingPage(page, expectedClass));
      } finally {
        const after = await page
          .locator("body")
          .evaluate((body) => body.innerHTML);
        mutationObserved ||= after !== before;
        await page.close();
      }
    };
    const invoke = (requestPath: string) =>
      runCommand(
        ["--runtime", privateRuntime, "--policy", policyPath, requestPath],
        { ...productionCommandDependencies, bookingBrowser: localCheckout }
      );

    await expect(invoke(firstRequestPath)).resolves.toBe(0);
    await expect(invoke(secondRequestPath)).resolves.toBe(0);
    await expect(invoke(firstRequestPath)).resolves.toBe(0);

    expect(browserInvocations).toBe(2);
    expect(mutationObserved).toBe(false);
    expect(observedProfiles).toEqual([
      join(privateRuntime, "Profile"),
      join(privateRuntime, "Profile")
    ]);
    for (const requestId of [requestIdOne, requestIdTwo]) {
      await expect(
        readFile(
          join(privateRuntime, "results", `${requestId}.json`),
          "utf8"
        ).then(JSON.parse)
      ).resolves.toMatchObject({
        request_id: requestId,
        outcome: "DRY_RUN",
        availability: "BOOKING_AVAILABLE"
      });
    }
  });
});
