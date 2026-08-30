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

const request = (requestId: string, dryRun = true): BookingRequest => ({
  schema_version: 1,
  request_id: requestId,
  booking_url:
    "https://app.arketa.co/iframe/example/calendar/checkout/FAKE_CHECKOUT_ID",
  expected_class: expectedClass,
  reserve_for: "myself",
  permitted_actions: ["book", "waitlist"],
  policy_version: "2030-01-01",
  allow_monetary_charge: false,
  dry_run: dryRun
});

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(value), "utf8");
}

async function writePolicy(path: string): Promise<void> {
  await writeJson(path, {
    schema_version: 1,
    policy_version: "2030-01-01",
    allowed_packages: ["Studio / 10-Class Pack"]
  });
}

describe("direct-command synthetic checkout", () => {
  test("keeps dry runs non-mutating across two UUIDs and recovers a repeated UUID", async () => {
    const privateRuntime = await mkdtemp(
      join(tmpdir(), "pilates-e2e-runtime-")
    );
    const externalConfig = await mkdtemp(join(tmpdir(), "pilates-e2e-config-"));
    const policyPath = join(externalConfig, "policy.json");
    const firstRequestPath = join(externalConfig, "request-one.json");
    const secondRequestPath = join(externalConfig, "request-two.json");
    await writePolicy(policyPath);
    await writeJson(firstRequestPath, request(requestIdOne));
    await writeJson(secondRequestPath, request(requestIdTwo));

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

  test.each([
    ["book", "BOOKED", "confirmation-booked"],
    ["waitlist", "WAITLISTED", "confirmation-waitlisted"]
  ] as const)(
    "submits %s once and accepts only its exact confirmation",
    async (action, outcome, confirmationTestId) => {
      const privateRuntime = await mkdtemp(
        join(tmpdir(), `pilates-${action}-runtime-`)
      );
      const externalConfig = await mkdtemp(
        join(tmpdir(), `pilates-${action}-config-`)
      );
      const policyPath = join(externalConfig, "policy.json");
      const requestPath = join(externalConfig, "request.json");
      const requestId =
        action === "book"
          ? "00000000-0000-4000-8000-000000000801"
          : "00000000-0000-4000-8000-000000000802";
      await writePolicy(policyPath);
      await writeJson(requestPath, request(requestId, false));

      let browserInvocations = 0;
      let submissionClicks = 0;
      const localCheckout: BookingBrowser = async (_profileDir, _url, use) => {
        browserInvocations += 1;
        const page = await browser.newPage();
        await page.setContent(bookingPageHtml({ action }));
        await page
          .getByRole("button", {
            name: action === "book" ? "Book" : "Join the waitlist",
            exact: true
          })
          .evaluate((button, testId) => {
            button.addEventListener("click", () => {
              document.body.dataset.submissionClicks = String(
                Number(document.body.dataset.submissionClicks ?? "0") + 1
              );
              document
                .querySelectorAll<HTMLInputElement>("input")
                .forEach((input) => {
                  input.checked = false;
                  input.value = "";
                });
              window.history.pushState({}, "", "#submitted");
              const confirmation = document.querySelector(
                `[data-testid="${testId}"]`
              );
              if (confirmation instanceof HTMLElement) {
                confirmation.hidden = false;
              }
            });
          }, confirmationTestId);
        try {
          return await use(
            createBookingPage(page, expectedClass, {
              confirmationTimeoutMs: 200
            })
          );
        } finally {
          submissionClicks += await page
            .locator("body")
            .evaluate((body) =>
              Number((body as HTMLElement).dataset.submissionClicks ?? "0")
            );
          await page.close();
        }
      };
      const invoke = () =>
        runCommand(
          ["--runtime", privateRuntime, "--policy", policyPath, requestPath],
          { ...productionCommandDependencies, bookingBrowser: localCheckout }
        );

      await expect(invoke()).resolves.toBe(0);
      await expect(invoke()).resolves.toBe(0);

      expect(browserInvocations).toBe(1);
      expect(submissionClicks).toBe(1);
      await expect(
        readFile(
          join(privateRuntime, "results", `${requestId}.json`),
          "utf8"
        ).then(JSON.parse)
      ).resolves.toMatchObject({
        request_id: requestId,
        outcome,
        action_submitted: true,
        submission_attempts: 1,
        confirmation_verified: true,
        retryable: false,
        safety_checks: {
          no_charge: true,
          cancellation_policy_accepted: true
        }
      });
    }
  );

  test("persists contradictory confirmation as uncertainty without resubmitting the UUID", async () => {
    const privateRuntime = await mkdtemp(
      join(tmpdir(), "pilates-uncertain-runtime-")
    );
    const externalConfig = await mkdtemp(
      join(tmpdir(), "pilates-uncertain-config-")
    );
    const policyPath = join(externalConfig, "policy.json");
    const requestPath = join(externalConfig, "request.json");
    const requestId = "00000000-0000-4000-8000-000000000803";
    await writePolicy(policyPath);
    await writeJson(requestPath, request(requestId, false));

    let browserInvocations = 0;
    let submissionClicks = 0;
    const localCheckout: BookingBrowser = async (_profileDir, _url, use) => {
      browserInvocations += 1;
      const page = await browser.newPage();
      await page.setContent(bookingPageHtml());
      await page
        .getByRole("button", { name: "Book", exact: true })
        .evaluate((button) => {
          button.addEventListener("click", () => {
            document.body.dataset.submissionClicks = String(
              Number(document.body.dataset.submissionClicks ?? "0") + 1
            );
            document
              .querySelectorAll<HTMLElement>('[data-testid^="confirmation-"]')
              .forEach((confirmation) => {
                confirmation.hidden = false;
              });
          });
        });
      try {
        return await use(
          createBookingPage(page, expectedClass, {
            confirmationTimeoutMs: 200
          })
        );
      } finally {
        submissionClicks += await page
          .locator("body")
          .evaluate((body) =>
            Number((body as HTMLElement).dataset.submissionClicks ?? "0")
          );
        await page.close();
      }
    };
    const invoke = () =>
      runCommand(
        ["--runtime", privateRuntime, "--policy", policyPath, requestPath],
        { ...productionCommandDependencies, bookingBrowser: localCheckout }
      );

    await expect(invoke()).resolves.toBe(40);
    await expect(invoke()).resolves.toBe(40);

    expect(browserInvocations).toBe(1);
    expect(submissionClicks).toBe(1);
    await expect(
      readFile(
        join(privateRuntime, "results", `${requestId}.json`),
        "utf8"
      ).then(JSON.parse)
    ).resolves.toMatchObject({
      request_id: requestId,
      outcome: "CONFIRMATION_UNCERTAIN",
      action_submitted: true,
      submission_attempts: 1,
      confirmation_verified: false,
      retryable: false
    });
  });

  test("safe stops a partial checkout without a submission click", async () => {
    const privateRuntime = await mkdtemp(
      join(tmpdir(), "pilates-partial-runtime-")
    );
    const externalConfig = await mkdtemp(
      join(tmpdir(), "pilates-partial-config-")
    );
    const policyPath = join(externalConfig, "policy.json");
    const requestPath = join(externalConfig, "request.json");
    const requestId = "00000000-0000-4000-8000-000000000804";
    await writePolicy(policyPath);
    await writeJson(requestPath, request(requestId, false));

    let submissionClicks = 0;
    const localCheckout: BookingBrowser = async (_profileDir, _url, use) => {
      const page = await browser.newPage();
      await page.setContent(bookingPageHtml({ cancellationCount: 0 }));
      await page
        .getByRole("button", { name: "Book", exact: true })
        .evaluate((button) => {
          button.addEventListener("click", () => {
            document.body.dataset.submissionClicks = "1";
          });
        });
      try {
        return await use(createBookingPage(page, expectedClass));
      } finally {
        submissionClicks += await page
          .locator("body")
          .evaluate((body) =>
            Number((body as HTMLElement).dataset.submissionClicks ?? "0")
          );
        await page.close();
      }
    };

    await expect(
      runCommand(
        ["--runtime", privateRuntime, "--policy", policyPath, requestPath],
        { ...productionCommandDependencies, bookingBrowser: localCheckout }
      )
    ).resolves.toBe(20);

    expect(submissionClicks).toBe(0);
    await expect(
      readFile(
        join(privateRuntime, "results", `${requestId}.json`),
        "utf8"
      ).then(JSON.parse)
    ).resolves.toMatchObject({
      request_id: requestId,
      outcome: "SAFE_STOP",
      action_submitted: false,
      submission_attempts: 0,
      confirmation_verified: false
    });
  });
});
