import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
  vi
} from "vitest";
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
afterEach(() => vi.restoreAllMocks());

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

test("public command recovers a lock whose PID is conclusively absent", async () => {
  const runtime = await mkdtemp(join(tmpdir(), "pilates-stale-e2e-"));
  const lockPath = join(runtime, "run.lock");
  const staleLock = `${JSON.stringify({ version: 2, pid: 77 })}\n`;
  await writeFile(lockPath, staleLock, "utf8");
  vi.spyOn(process, "kill").mockImplementation(() => {
    throw Object.assign(new Error("synthetic private process message"), {
      code: "ESRCH"
    });
  });
  let browserInvocations = 0;
  const bookingBrowser: BookingBrowser = async (_profile, _url, use) => {
    browserInvocations += 1;
    const page = await browser.newPage();
    try {
      await page.setContent(bookingPageHtml({ action: "already_booked" }));
      return await use(createBookingPage(page));
    } finally {
      await page.close();
    }
  };
  let stdout = "";

  const exit = await runCommand(
    [
      "--booking-url",
      checkoutUrl,
      "--allow-package",
      "Studio / 10-Class Pack",
      "--runtime",
      runtime
    ],
    {
      bookingBrowser,
      emitResult: async (bytes) => {
        stdout += bytes;
      }
    }
  );

  const expected: BookingResult = {
    schema_version: 2,
    outcome: "ALREADY_BOOKED",
    exit_code: 0,
    action_submitted: false,
    confirmation_verified: true,
    observed_class: observedClass,
    safety_checks: {
      approved_package_verified: false,
      no_charge: false,
      cancellation_policy_accepted: false
    },
    details: "Existing booking confirmed."
  };
  expect(exit).toBe(0);
  expect(stdout).toBe(`${JSON.stringify(expected)}\n`);
  expect(validateResult(JSON.parse(stdout))).toBe(true);
  expect(browserInvocations).toBe(1);
  expect(await readdir(runtime)).toEqual([]);
  expect(stdout).not.toContain(staleLock.trim());
});

test("public command preserves an ambiguous PID lock before browser and debug work", async () => {
  const runtime = await mkdtemp(join(tmpdir(), "pilates-lock-e2e-"));
  const lockPath = join(runtime, "run.lock");
  const ambiguousLock = `${JSON.stringify({ version: 2, pid: 77 })}\n`;
  await writeFile(lockPath, ambiguousLock, "utf8");
  vi.spyOn(process, "kill").mockImplementation(() => {
    throw Object.assign(new Error("synthetic private process message"), {
      code: "EPERM"
    });
  });
  let browserInvocations = 0;
  const bookingBrowser: BookingBrowser = async () => {
    browserInvocations += 1;
    throw new Error("browser must not open while the runtime lock is held");
  };
  let stdout = "";

  const exit = await runCommand(
    [
      "--booking-url",
      checkoutUrl,
      "--allow-package",
      "Studio / 10-Class Pack",
      "--runtime",
      runtime,
      "--debug"
    ],
    {
      bookingBrowser,
      emitResult: async (bytes) => {
        stdout += bytes;
      }
    }
  );

  const expected: BookingResult = {
    schema_version: 2,
    outcome: "TECHNICAL_FAILURE",
    exit_code: 30,
    action_submitted: false,
    confirmation_verified: false,
    safety_checks: {
      approved_package_verified: false,
      no_charge: false,
      cancellation_policy_accepted: false
    },
    details: "Runtime operation failed."
  };
  expect(exit).toBe(30);
  expect(stdout).toBe(`${JSON.stringify(expected)}\n`);
  expect(validateResult(JSON.parse(stdout))).toBe(true);
  expect(browserInvocations).toBe(0);
  expect(await readdir(runtime)).toEqual(["run.lock"]);
  expect(await readFile(lockPath, "utf8")).toBe(ambiguousLock);
  expect(stdout).not.toContain(ambiguousLock.trim());
});
