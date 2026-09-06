import { readFile } from "node:fs/promises";

import { afterEach, expect, it, vi } from "vitest";

import { runCli } from "../src/cli.js";
import {
  COMMAND_FAILURE_DIAGNOSTIC,
  reportCommandDiagnostic,
  runCommand
} from "../src/command.js";

vi.mock("../src/cli.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/cli.js")>();
  return { ...actual, runCli: vi.fn(actual.runCli) };
});

const checkoutUrl =
  "https://app.arketa.co/iframe/synthetic/calendar/checkout/command";

const validArguments = [
  "--booking-url",
  checkoutUrl,
  "--allow-package",
  "Synthetic Package",
  "--dry-run"
] as const;

afterEach(() => {
  vi.restoreAllMocks();
});

it("builds the public executable before the test suite", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8")
  ) as { scripts?: Record<string, string> };
  expect(packageJson.scripts?.pretest).toBe("npm run build");
});

it("passes the validated public arguments to one workflow invocation", async () => {
  const execute = vi.fn(
    async (context: { advance(stage: "VALIDATED"): Promise<void> }) => {
      await context.advance("VALIDATED");
      return {
        schema_version: 2 as const,
        outcome: "SAFE_STOP" as const,
        exit_code: 20 as const,
        action_submitted: false as const,
        confirmation_verified: false as const,
        safety_checks: {
          approved_package_verified: false as const,
          no_charge: false as const,
          cancellation_policy_accepted: false as const
        },
        details: "Booking stopped safely." as const
      };
    }
  );
  const emitResult = vi.fn(async () => undefined);
  const acquireLock = vi.fn(async () => ({
    release: async () => ({ released: true as const })
  }));

  expect(
    await runCommand(
      [
        "--booking-url",
        checkoutUrl,
        "--allow-package",
        "First Pack",
        "--allow-package",
        "Second Pack",
        "--runtime",
        "/private/runtime",
        "--book-only"
      ],
      { execute, emitResult, acquireLock }
    )
  ).toBe(20);
  expect(execute).toHaveBeenCalledOnce();
  const calls = execute.mock.calls as unknown as readonly [
    readonly [{ input: unknown }]
  ];
  expect(calls[0][0].input).toEqual({
    booking_url: checkoutUrl,
    allowed_packages: ["First Pack", "Second Pack"],
    permitted_actions: ["book"],
    dry_run: false
  });
});

it("rejects invalid arguments before acquiring the runtime lock", async () => {
  const acquireLock = vi.fn();
  const reportDiagnostic = vi.fn();
  expect(
    await runCommand(["--unknown"], { acquireLock, reportDiagnostic })
  ).toBe(30);
  expect(acquireLock).not.toHaveBeenCalled();
  expect(reportDiagnostic).toHaveBeenCalledWith(COMMAND_FAILURE_DIAGNOSTIC);
});

it("projects the fixed command diagnostic through console error", () => {
  const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);

  reportCommandDiagnostic(COMMAND_FAILURE_DIAGNOSTIC);

  expect(stderr).toHaveBeenCalledOnce();
  expect(stderr).toHaveBeenCalledWith(COMMAND_FAILURE_DIAGNOSTIC);
});

it("swallows a throwing diagnostic transport after argument rejection", async () => {
  const privateFailure = "synthetic private diagnostic transport stack";
  const stdout = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const acquireLock = vi.fn();
  const reportDiagnostic = vi.fn(() => {
    throw new Error(privateFailure);
  });

  await expect(
    runCommand(["--unknown"], { acquireLock, reportDiagnostic })
  ).resolves.toBe(30);

  expect(acquireLock).not.toHaveBeenCalled();
  expect(reportDiagnostic).toHaveBeenCalledOnce();
  expect(reportDiagnostic).toHaveBeenCalledWith(COMMAND_FAILURE_DIAGNOSTIC);
  expect(stdout).not.toHaveBeenCalled();
  expect(stderr).not.toHaveBeenCalled();
});

it("converts an unexpected CLI rejection to the fixed diagnostic", async () => {
  const privateFailure = "synthetic private runCli stack";
  const stdout = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.mocked(runCli).mockRejectedValueOnce(new Error(privateFailure));

  await expect(runCommand(validArguments)).resolves.toBe(30);

  expect(runCli).toHaveBeenCalledOnce();
  expect(stdout).not.toHaveBeenCalled();
  expect(stderr).toHaveBeenCalledOnce();
  expect(stderr).toHaveBeenCalledWith(COMMAND_FAILURE_DIAGNOSTIC);
  expect(stderr.mock.calls.flat().join("\n")).not.toContain(privateFailure);
});
