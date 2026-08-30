import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { describe, expect, test } from "vitest";

import {
  parseCommandArguments,
  runCommand,
  type CommandDependencies
} from "../src/command.js";
import type {
  BookingPolicy,
  BookingRequest,
  BookingResult
} from "../src/contracts.js";

const requestId = "00000000-0000-4000-8000-000000000701";
const policy: BookingPolicy = {
  schema_version: 1,
  policy_version: "2030-01-01",
  allowed_packages: ["Synthetic Priority Package"]
};
const request: BookingRequest = {
  schema_version: 1,
  request_id: requestId,
  booking_url:
    "https://app.arketa.co/iframe/example/calendar/checkout/FAKE_CHECKOUT_ID",
  expected_class: {
    name: "Synthetic Reformer Flow",
    date: "2030-01-16",
    start_time: "10:30",
    timezone: "America/Los_Angeles"
  },
  reserve_for: "myself",
  permitted_actions: ["book", "waitlist"],
  policy_version: "2030-01-01",
  allow_monetary_charge: false,
  dry_run: true
};

describe("parseCommandArguments", () => {
  test("extracts one absolute POSIX runtime and preserves CLI arguments", () => {
    expect(
      parseCommandArguments([
        "--runtime",
        "/private/runtime",
        "--policy",
        "policy.json",
        "request.json"
      ])
    ).toEqual({
      runtimeDir: "/private/runtime",
      cliArguments: ["--policy", "policy.json", "request.json"]
    });
  });

  test("accepts an absolute Windows runtime on every host", () => {
    const runtimeDir = win32.join("C:\\", "Private", "Arketa Runtime");
    expect(
      parseCommandArguments([
        "--runtime",
        runtimeDir,
        "--policy",
        "policy.json",
        "request.json"
      ])
    ).toEqual({
      runtimeDir,
      cliArguments: ["--policy", "policy.json", "request.json"]
    });
  });

  test.each([
    ["missing", ["--policy", "policy.json", "request.json"]],
    [
      "relative",
      ["--runtime", "runtime", "--policy", "policy.json", "request.json"]
    ],
    [
      "duplicate",
      [
        "--runtime",
        "/private/one",
        "--runtime",
        "/private/two",
        "--policy",
        "policy.json",
        "request.json"
      ]
    ]
  ] as const)("rejects a %s runtime argument", (_name, argv) => {
    expect(parseCommandArguments(argv)).toBeUndefined();
  });
});

describe("runCommand", () => {
  test("runs the existing CLI with a private runtime and request-keyed result", async () => {
    const runtimeDir = await mkdtemp(join(tmpdir(), "pilates-command-"));
    const result: BookingResult = {
      schema_version: 1,
      request_id: requestId,
      outcome: "SAFE_STOP",
      exit_code: 20,
      action_submitted: false,
      confirmation_verified: false,
      safety_checks: {
        exact_class_match: false,
        approved_package_verified: false,
        no_charge: false,
        cancellation_policy_accepted: false
      },
      details: "Booking stopped safely."
    };
    const dependencies: CommandDependencies = {
      cwd: runtimeDir,
      loadPolicy: async () => policy,
      loadRequest: async () => request,
      validateRequest: (value) => value as BookingRequest,
      execute: async ({ advance }) => {
        await advance("VALIDATED");
        return result;
      }
    };

    await expect(
      runCommand(
        ["--runtime", runtimeDir, "--policy", "policy.json", "request.json"],
        dependencies
      )
    ).resolves.toBe(20);
    await expect(
      readFile(join(runtimeDir, "results", `${requestId}.json`), "utf8").then(
        JSON.parse
      )
    ).resolves.toMatchObject({ request_id: requestId, outcome: "SAFE_STOP" });
  });
});
