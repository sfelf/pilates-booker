import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { createBookingPage, type BookingBrowser } from "../src/booking-page.js";
import { productionCommandDependencies, runCommand } from "../src/command.js";
import type { BookingRequest, BookingResult } from "../src/contracts.js";
import { bookingPageHtml } from "./fixtures/checkout.js";

const requestIdOne = "00000000-0000-4000-8000-000000000701";
const requestIdTwo = "00000000-0000-4000-8000-000000000702";
const expectedClass = {
  name: "Reformer – Début ✨",
  date: "2026-09-01",
  start_time: "09:30",
  timezone: "America/Los_Angeles"
} as const;
const syntheticPrivateMarker = "synthetic-private@example.test";
const selectedPackage = "Studio / 10-Class Pack";
const expectedPackagesBefore = [
  { name: selectedPackage, remaining: 3, approved: true },
  { name: "Intro / 5-Class Pack", remaining: 1, approved: false }
] as const;
const removedResultFields = [
  "package_used",
  "submission_attempts",
  "retryable",
  "failure_stage",
  "current_payment_state"
] as const;

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

async function expectFinalizedCommandOutput(
  stdout: readonly string[],
  stderr: readonly string[],
  resultPath: string,
  expected: Readonly<{
    exitCode: number;
    outcome: BookingResult["outcome"];
    hasPackageEvidence: boolean;
    hasCalendarUrl: boolean;
  }>
): Promise<BookingResult> {
  const durable = await readFile(resultPath, "utf8");

  expect(stdout).toEqual([durable]);
  expect(stderr).toEqual([]);
  expect(durable).toBe(`${JSON.stringify(JSON.parse(durable))}\n`);
  expect(durable.split("\n")).toHaveLength(2);
  expect(durable).not.toContain(syntheticPrivateMarker);

  const result = JSON.parse(durable) as BookingResult;
  expect(result).toMatchObject({
    outcome: expected.outcome,
    exit_code: expected.exitCode
  });
  for (const removedField of removedResultFields) {
    expect(result).not.toHaveProperty(removedField);
  }
  if (expected.hasPackageEvidence) {
    expect(result).toMatchObject({
      package_selected: selectedPackage,
      packages_before: expectedPackagesBefore
    });
  } else {
    expect(result).not.toHaveProperty("package_selected");
    expect(result).not.toHaveProperty("packages_before");
  }
  if (expected.hasCalendarUrl) {
    expect(result).toMatchObject({
      google_calendar_url:
        "https://app.arketa.co/api/calendar/google?classId=FAKE_CHECKOUT_ID"
    });
  } else {
    expect(result).not.toHaveProperty("google_calendar_url");
  }
  return result;
}

type SubprocessResult = Readonly<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
}>;

function runProcess(
  command: string,
  arguments_: readonly string[]
): Promise<SubprocessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}

function runNodeProcess(
  arguments_: readonly string[]
): Promise<SubprocessResult> {
  return runProcess(process.execPath, arguments_);
}

async function writeCompiledCommandHarness(path: string): Promise<void> {
  const commandUrl = new URL("../dist/command.js", import.meta.url).href;
  await writeFile(
    path,
    `import { appendFile } from "node:fs/promises";
import { runCommand } from ${JSON.stringify(commandUrl)};

const [scenario, runtimeDir, executionLog] = process.argv.slice(2);
if (scenario === "failure") {
  process.exitCode = await runCommand([]);
} else {
  const requestId = "00000000-0000-4000-8000-000000000805";
  const request = {
    schema_version: 1,
    request_id: requestId,
    booking_url: "https://app.arketa.co/iframe/example/calendar/checkout/FAKE_CHECKOUT_ID",
    expected_class: {
      name: "Synthetic subprocess class",
      date: "2030-01-02",
      start_time: "09:30",
      timezone: "America/Los_Angeles"
    },
    reserve_for: "myself",
    permitted_actions: ["book", "waitlist"],
    policy_version: "2030-01-01",
    allow_monetary_charge: false,
    dry_run: true
  };
  const policy = {
    schema_version: 1,
    policy_version: "2030-01-01",
    allowed_packages: ["Synthetic Approved Package"]
  };
  const result = {
    schema_version: 1,
    request_id: requestId,
    outcome: "DRY_RUN",
    exit_code: 0,
    action_submitted: false,
    confirmation_verified: false,
    availability: "BOOKING_AVAILABLE",
    observed_class: {
      name: "Synthetic subprocess class",
      instructor: "Synthetic Instructor",
      date: "2030-01-02",
      start_time: "09:30",
      end_time: "10:20",
      timezone: "America/Los_Angeles"
    },
    package_selected: "Synthetic Approved Package",
    packages_before: [
      { name: "Synthetic Approved Package", remaining: 1, approved: true }
    ],
    safety_checks: {
      exact_class_match: true,
      approved_package_verified: true,
      no_charge: false,
      cancellation_policy_accepted: false
    },
    details: "Dry run completed."
  };
  process.exitCode = await runCommand(
    ["--runtime", runtimeDir, "--policy", "synthetic-policy.json", "synthetic-request.json"],
    {
      loadPolicy: async () => policy,
      loadRequest: async () => request,
      validateRequest: (value) => value,
      execute: async ({ advance }) => {
        await appendFile(executionLog, "executed\\n", "utf8");
        await advance("VALIDATED");
        return result;
      }
    }
  );
}
`,
    "utf8"
  );
}

describe("compiled command stream boundary", () => {
  test("writes finalized synthetic result bytes to stdout and isolates fixed failures on stderr", async () => {
    const build = await runProcess("npm", [
      "exec",
      "--no",
      "--",
      "tsc",
      "-p",
      "tsconfig.build.json"
    ]);
    expect(build).toEqual({ exitCode: 0, stdout: "", stderr: "" });

    const privateRuntime = await mkdtemp(
      join(tmpdir(), "pilates-subprocess-runtime-")
    );
    const externalHarness = await mkdtemp(
      join(tmpdir(), "pilates-subprocess-harness-")
    );
    const harnessPath = join(externalHarness, "synthetic-command.mjs");
    const executionLog = join(externalHarness, "executions.log");
    const requestId = "00000000-0000-4000-8000-000000000805";
    await writeCompiledCommandHarness(harnessPath);

    const successArguments = [
      harnessPath,
      "success",
      privateRuntime,
      executionLog
    ];
    const first = await runNodeProcess(successArguments);
    const resultPath = join(privateRuntime, "results", `${requestId}.json`);
    const durable = await readFile(resultPath, "utf8");
    expect(first).toEqual({ exitCode: 0, stdout: durable, stderr: "" });

    const recovered = await runNodeProcess(successArguments);
    expect(recovered).toEqual({ exitCode: 0, stdout: durable, stderr: "" });
    await expect(readFile(executionLog, "utf8")).resolves.toBe("executed\n");

    const failure = await runNodeProcess([harnessPath, "failure"]);
    expect(failure).toEqual({
      exitCode: 30,
      stdout: "",
      stderr: "Booking command failed.\n"
    });
  });
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
    await writePolicy(policyPath);
    await writeJson(firstRequestPath, request(requestIdOne));
    await writeJson(secondRequestPath, request(requestIdTwo));

    const observedProfiles: string[] = [];
    const stdout: string[] = [];
    const stderr: string[] = [];
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
        {
          ...productionCommandDependencies,
          bookingBrowser: localCheckout,
          emitResult: async (bytes) => {
            stdout.push(bytes);
          },
          reportDiagnostic: (diagnostic) => {
            stderr.push(diagnostic);
          }
        }
      );

    for (const requestId of [requestIdOne, requestIdTwo, requestIdOne]) {
      stdout.length = 0;
      stderr.length = 0;
      await expect(
        invoke(
          requestId === requestIdTwo ? secondRequestPath : firstRequestPath
        )
      ).resolves.toBe(0);
      await expectFinalizedCommandOutput(
        stdout,
        stderr,
        join(privateRuntime, "results", `${requestId}.json`),
        {
          exitCode: 0,
          outcome: "DRY_RUN",
          hasPackageEvidence: true,
          hasCalendarUrl: false
        }
      );
    }

    expect(browserInvocations).toBe(2);
    expect(mutationObserved).toBe(false);
    expect(observedProfiles).toEqual([
      join(privateRuntime, "Profile"),
      join(privateRuntime, "Profile")
    ]);
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
      const stdout: string[] = [];
      const stderr: string[] = [];
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
              if (testId === "confirmation-booked") {
                const googleLink = document.createElement("a");
                googleLink.href =
                  "https://app.arketa.co/api/calendar/google?classId=FAKE_CHECKOUT_ID";
                googleLink.textContent = "Google";
                document.body.append(googleLink);
              }
            });
          }, confirmationTestId);
        try {
          return await use(
            createBookingPage(page, expectedClass, {
              classId: "FAKE_CHECKOUT_ID",
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
          {
            ...productionCommandDependencies,
            bookingBrowser: localCheckout,
            emitResult: async (bytes) => {
              stdout.push(bytes);
            },
            reportDiagnostic: (diagnostic) => {
              stderr.push(diagnostic);
            }
          }
        );

      await expect(invoke()).resolves.toBe(0);
      await expectFinalizedCommandOutput(
        stdout,
        stderr,
        join(privateRuntime, "results", `${requestId}.json`),
        {
          exitCode: 0,
          outcome,
          hasPackageEvidence: true,
          hasCalendarUrl: action === "book"
        }
      );
      stdout.length = 0;
      stderr.length = 0;
      await expect(invoke()).resolves.toBe(0);
      await expectFinalizedCommandOutput(
        stdout,
        stderr,
        join(privateRuntime, "results", `${requestId}.json`),
        {
          exitCode: 0,
          outcome,
          hasPackageEvidence: true,
          hasCalendarUrl: action === "book"
        }
      );

      expect(browserInvocations).toBe(1);
      expect(submissionClicks).toBe(1);
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
    const stdout: string[] = [];
    const stderr: string[] = [];
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
        {
          ...productionCommandDependencies,
          bookingBrowser: localCheckout,
          emitResult: async (bytes) => {
            stdout.push(bytes);
          },
          reportDiagnostic: (diagnostic) => {
            stderr.push(diagnostic);
          }
        }
      );

    await expect(invoke()).resolves.toBe(40);
    await expectFinalizedCommandOutput(
      stdout,
      stderr,
      join(privateRuntime, "results", `${requestId}.json`),
      {
        exitCode: 40,
        outcome: "CONFIRMATION_UNCERTAIN",
        hasPackageEvidence: false,
        hasCalendarUrl: false
      }
    );
    stdout.length = 0;
    stderr.length = 0;
    await expect(invoke()).resolves.toBe(40);
    await expectFinalizedCommandOutput(
      stdout,
      stderr,
      join(privateRuntime, "results", `${requestId}.json`),
      {
        exitCode: 40,
        outcome: "CONFIRMATION_UNCERTAIN",
        hasPackageEvidence: false,
        hasCalendarUrl: false
      }
    );

    expect(browserInvocations).toBe(1);
    expect(submissionClicks).toBe(1);
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
    const stdout: string[] = [];
    const stderr: string[] = [];
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
        {
          ...productionCommandDependencies,
          bookingBrowser: localCheckout,
          emitResult: async (bytes) => {
            stdout.push(bytes);
          },
          reportDiagnostic: (diagnostic) => {
            stderr.push(diagnostic);
          }
        }
      )
    ).resolves.toBe(20);

    expect(submissionClicks).toBe(0);
    await expectFinalizedCommandOutput(
      stdout,
      stderr,
      join(privateRuntime, "results", `${requestId}.json`),
      {
        exitCode: 20,
        outcome: "SAFE_STOP",
        hasPackageEvidence: false,
        hasCalendarUrl: false
      }
    );
  });
});
