import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it, vi } from "vitest";

import { runCli, type ExecutionContext } from "../src/cli.js";
import type { CommandArguments } from "../src/command-arguments.js";
import type { BookingResult, ExecutionStage } from "../src/contracts.js";
import type { DebugEvent, DebugLogger } from "../src/debug-log.js";

const args: CommandArguments = {
  input: {
    booking_url:
      "https://app.arketa.co/iframe/synthetic/calendar/checkout/coordinator",
    allowed_packages: ["Synthetic Pack"],
    permitted_actions: ["book", "waitlist"],
    dry_run: false
  },
  runtimeDir: "/private/runtime",
  debug: false
};

const result: BookingResult = {
  schema_version: 2,
  outcome: "SAFE_STOP",
  exit_code: 20,
  action_submitted: false,
  confirmation_verified: false,
  safety_checks: {
    approved_package_verified: false,
    no_charge: false,
    cancellation_policy_accepted: false
  },
  details: "Booking stopped safely."
};

function dependencies(
  execute: (context: ExecutionContext) => Promise<BookingResult>
) {
  const release = vi.fn(async () => ({ released: true as const }));
  const acquireLock = vi.fn(async () => ({ release }));
  const emitResult = vi.fn(async () => undefined);
  return { execute, acquireLock, emitResult, release };
}

it("executes identical invocations independently instead of replaying local state", async () => {
  const execute = vi.fn(async () => result);
  const first = dependencies(execute);
  const second = dependencies(execute);

  expect(await runCli(args, first)).toBe(20);
  expect(await runCli(args, second)).toBe(20);
  expect(execute).toHaveBeenCalledTimes(2);
  expect(first.acquireLock).toHaveBeenCalledWith("/private/runtime/run.lock");
  expect(first.emitResult).toHaveBeenCalledWith(`${JSON.stringify(result)}\n`);
  expect(first.release).toHaveBeenCalledOnce();
});

it("creates no journal, result, or UUID artifacts for an invocation", async () => {
  const runtimeDir = await mkdtemp(join(tmpdir(), "pilates-v2-runtime-"));
  expect(
    await runCli(
      { ...args, runtimeDir },
      { execute: async () => result, emitResult: async () => undefined }
    )
  ).toBe(20);

  expect(await readdir(runtimeDir)).toEqual([]);
});

it.each([
  ["VALIDATED", "TECHNICAL_FAILURE", 30, false],
  ["READY_TO_SUBMIT", "TECHNICAL_FAILURE", 30, false],
  ["SUBMITTING", "CONFIRMATION_UNCERTAIN", 40, true],
  ["CONFIRMED", "CONFIRMATION_UNCERTAIN", 40, true]
] as const)(
  "classifies a failure at %s using only the in-memory stage",
  async (stage, outcome, exitCode, actionSubmitted) => {
    const deps = dependencies(async (context) => {
      const stages: readonly ExecutionStage[] =
        stage === "VALIDATED"
          ? ["VALIDATED"]
          : stage === "READY_TO_SUBMIT"
            ? ["VALIDATED", "READY_TO_SUBMIT"]
            : stage === "SUBMITTING"
              ? ["VALIDATED", "READY_TO_SUBMIT", "SUBMITTING"]
              : ["VALIDATED", "READY_TO_SUBMIT", "SUBMITTING", "CONFIRMED"];
      for (const next of stages) await context.advance(next);
      throw new Error("synthetic failure");
    });

    expect(await runCli(args, deps)).toBe(exitCode);
    const emitted = deps.emitResult.mock.calls as unknown as readonly [
      readonly [string]
    ];
    expect(JSON.parse(emitted[0][0])).toMatchObject({
      schema_version: 2,
      outcome,
      exit_code: exitCode,
      action_submitted: actionSubmitted,
      confirmation_verified: false
    });
  }
);

it("rejects skipped or backward stage transitions as pre-submission failures", async () => {
  const skipped = dependencies(async (context) => {
    await context.advance("READY_TO_SUBMIT");
    return result;
  });
  expect(await runCli(args, skipped)).toBe(30);
  expect(skipped.emitResult).toHaveBeenCalledOnce();
  const bytes = (skipped.emitResult.mock.calls as unknown as [[string]])[0][0];
  expect(JSON.parse(bytes)).toMatchObject({
    outcome: "TECHNICAL_FAILURE",
    action_submitted: false
  });
});

it("emits a technical failure when lock acquisition fails", async () => {
  const emitResult = vi.fn(async () => undefined);
  expect(
    await runCli(args, {
      acquireLock: async () => {
        throw new Error("lock failed");
      },
      emitResult
    })
  ).toBe(30);
  expect(
    JSON.parse((emitResult.mock.calls as unknown as [[string]])[0][0])
  ).toMatchObject({ outcome: "TECHNICAL_FAILURE" });
});

it("downgrades a confirmed result to uncertainty when lock release fails", async () => {
  const booked: BookingResult = {
    schema_version: 2,
    outcome: "BOOKED",
    exit_code: 0,
    action_submitted: true,
    confirmation_verified: true,
    observed_class: {
      name: "Synthetic Class",
      instructor: "Synthetic Instructor",
      date: "2030-01-16",
      start_time: "10:30",
      end_time: "11:20",
      timezone: "America/Los_Angeles"
    },
    package_selected: "Synthetic Pack",
    packages_before: [{ name: "Synthetic Pack", remaining: 2, approved: true }],
    safety_checks: {
      approved_package_verified: true,
      no_charge: true,
      cancellation_policy_accepted: true
    },
    details: "Booking confirmed."
  };
  const emitResult = vi.fn(async () => undefined);
  expect(
    await runCli(args, {
      execute: async (context) => {
        for (const stage of [
          "VALIDATED",
          "READY_TO_SUBMIT",
          "SUBMITTING",
          "CONFIRMED"
        ] as const)
          await context.advance(stage);
        return booked;
      },
      acquireLock: async () => ({
        release: async () => ({
          released: false as const,
          stage: "unlink" as const
        })
      }),
      emitResult
    })
  ).toBe(40);
  expect(
    JSON.parse((emitResult.mock.calls as unknown as [[string]])[0][0])
  ).toMatchObject({ outcome: "CONFIRMATION_UNCERTAIN" });
});

it("returns the fixed transport failure when stdout cannot accept the result", async () => {
  const reportDiagnostic = vi.fn();
  const events: DebugEvent[] = [];
  expect(
    await runCli(
      { ...args, debug: true },
      {
        execute: async () => result,
        acquireLock: async () => ({
          release: async () => ({ released: true as const })
        }),
        emitResult: async () => {
          throw new Error("stdout failed");
        },
        createLogger: async () => ({
          append: async (event) => {
            events.push(event);
          }
        }),
        reportDiagnostic
      }
    )
  ).toBe(30);
  expect(reportDiagnostic).toHaveBeenCalledWith("Booking command failed.");
  expect(events.at(-1)).toMatchObject({ response_emitted: false });
});

it("does not initialize or touch the debug logger when debug is disabled", async () => {
  const createLogger = vi.fn<() => Promise<DebugLogger>>();
  expect(
    await runCli(args, {
      ...dependencies(async () => result),
      createLogger
    })
  ).toBe(20);
  expect(createLogger).not.toHaveBeenCalled();
});

it("initializes requested logging before lock or browser work and records validated arguments", async () => {
  const calls: string[] = [];
  const events: DebugEvent[] = [];
  const createLogger = vi.fn(async () => ({
    append: async (event: DebugEvent) => {
      events.push(event);
    }
  }));
  expect(
    await runCli(
      { ...args, debug: true },
      {
        createLogger,
        acquireLock: async () => {
          calls.push("lock");
          return { release: async () => ({ released: true as const }) };
        },
        execute: async () => {
          calls.push("browser");
          return result;
        },
        emitResult: async () => undefined
      }
    )
  ).toBe(20);
  expect(createLogger).toHaveBeenCalledOnce();
  expect(calls).toEqual(["lock", "browser"]);
  expect(events[0]).toMatchObject({
    event: "command.started",
    stage: "STARTING",
    submission_started: false,
    response_emitted: false,
    data: {
      arguments: {
        booking_url: args.input.booking_url,
        allowed_packages: ["Synthetic Pack"],
        runtime: "/private/runtime",
        debug: true
      }
    }
  });
  expect(events.at(-1)).toMatchObject({ response_emitted: true });
});

it("prevents lock and browser work when requested log initialization fails", async () => {
  const acquireLock = vi.fn();
  const execute = vi.fn();
  const emitResult = vi.fn(async () => undefined);
  expect(
    await runCli(
      { ...args, debug: true },
      {
        createLogger: async () => {
          throw new Error("log initialization failed");
        },
        acquireLock,
        execute,
        emitResult
      }
    )
  ).toBe(30);
  expect(acquireLock).not.toHaveBeenCalled();
  expect(execute).not.toHaveBeenCalled();
  expect(
    JSON.parse((emitResult.mock.calls as unknown as [[string]])[0][0])
  ).toMatchObject({
    outcome: "TECHNICAL_FAILURE",
    action_submitted: false
  });
});

it("classifies a submission-stage logging failure as uncertain without retrying", async () => {
  const execute = vi.fn(async (context: ExecutionContext) => {
    await context.advance("VALIDATED");
    await context.advance("READY_TO_SUBMIT");
    await context.advance("SUBMITTING");
    throw new Error("unreachable");
  });
  const emitResult = vi.fn(async () => undefined);
  expect(
    await runCli(
      { ...args, debug: true },
      {
        createLogger: async () => ({
          append: async (event) => {
            if (event.stage === "SUBMITTING") throw new Error("log failed");
          }
        }),
        execute,
        acquireLock: async () => ({
          release: async () => ({ released: true as const })
        }),
        emitResult
      }
    )
  ).toBe(40);
  expect(execute).toHaveBeenCalledOnce();
  expect(
    JSON.parse((emitResult.mock.calls as unknown as [[string]])[0][0])
  ).toMatchObject({
    outcome: "CONFIRMATION_UNCERTAIN",
    action_submitted: true
  });
});
