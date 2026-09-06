import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it, vi } from "vitest";

import { runCli, type ExecutionContext } from "../src/cli.js";
import type { CommandArguments } from "../src/command-arguments.js";
import type {
  BookingResult,
  ExecutionStage,
  Outcome
} from "../src/contracts.js";
import type { DebugEvent, DebugLogger } from "../src/debug-log.js";
import { APPLICATION_VERSION } from "../src/version.js";

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

const observedClass = {
  name: "Synthetic Class",
  instructor: "Synthetic Instructor",
  date: "2030-01-16",
  start_time: "10:30",
  end_time: "11:20",
  timezone: "America/Los_Angeles"
} as const;

const completedSafetyChecks = {
  approved_package_verified: true,
  no_charge: true,
  cancellation_policy_accepted: true
} as const;

const incompleteSafetyChecks = {
  approved_package_verified: false,
  no_charge: false,
  cancellation_policy_accepted: false
} as const;

function resultForOutcome(outcome: Outcome): BookingResult {
  if (outcome === "BOOKED") {
    return {
      schema_version: 2,
      outcome,
      exit_code: 0,
      action_submitted: true,
      confirmation_verified: true,
      observed_class: observedClass,
      package_selected: "Synthetic Pack",
      packages_before: [
        { name: "Synthetic Pack", remaining: 2, approved: true }
      ],
      safety_checks: completedSafetyChecks,
      details: "Booking confirmed."
    };
  }
  if (outcome === "WAITLISTED") {
    return {
      schema_version: 2,
      outcome,
      exit_code: 0,
      action_submitted: true,
      confirmation_verified: true,
      observed_class: observedClass,
      package_selected: "Synthetic Pack",
      packages_before: [
        { name: "Synthetic Pack", remaining: 2, approved: true }
      ],
      safety_checks: completedSafetyChecks,
      details: "Waitlist confirmed."
    };
  }
  if (outcome === "ALREADY_BOOKED") {
    return {
      schema_version: 2,
      outcome,
      exit_code: 0,
      action_submitted: false,
      confirmation_verified: true,
      observed_class: observedClass,
      safety_checks: incompleteSafetyChecks,
      details: "Existing booking confirmed."
    };
  }
  if (outcome === "ALREADY_WAITLISTED") {
    return {
      schema_version: 2,
      outcome,
      exit_code: 0,
      action_submitted: false,
      confirmation_verified: true,
      observed_class: observedClass,
      safety_checks: incompleteSafetyChecks,
      details: "Existing waitlist confirmed."
    };
  }
  if (outcome === "DRY_RUN") {
    return {
      schema_version: 2,
      outcome,
      exit_code: 0,
      action_submitted: false,
      confirmation_verified: false,
      availability: "BOOKING_AVAILABLE",
      observed_class: observedClass,
      package_selected: "Synthetic Pack",
      packages_before: [
        { name: "Synthetic Pack", remaining: 2, approved: true }
      ],
      safety_checks: {
        approved_package_verified: true,
        no_charge: false,
        cancellation_policy_accepted: false
      },
      details: "Dry run completed."
    };
  }
  if (outcome === "SAFE_STOP") return result;
  if (outcome === "TECHNICAL_FAILURE") {
    return {
      schema_version: 2,
      outcome,
      exit_code: 30,
      action_submitted: false,
      confirmation_verified: false,
      safety_checks: incompleteSafetyChecks,
      details: "Runtime operation failed."
    };
  }
  return {
    schema_version: 2,
    outcome,
    exit_code: 40,
    action_submitted: true,
    confirmation_verified: false,
    safety_checks: completedSafetyChecks,
    details: "Booking confirmation is uncertain."
  };
}

const executionStages = [
  "STARTING",
  "VALIDATED",
  "READY_TO_SUBMIT",
  "SUBMITTING",
  "CONFIRMED"
] as const;
type ResultStage = (typeof executionStages)[number];

const outcomes = [
  "BOOKED",
  "WAITLISTED",
  "ALREADY_BOOKED",
  "ALREADY_WAITLISTED",
  "DRY_RUN",
  "SAFE_STOP",
  "TECHNICAL_FAILURE",
  "CONFIRMATION_UNCERTAIN"
] as const;

const validOutcomesByStage: Readonly<
  Record<(typeof executionStages)[number], readonly Outcome[]>
> = {
  STARTING: ["TECHNICAL_FAILURE"],
  VALIDATED: [
    "ALREADY_BOOKED",
    "ALREADY_WAITLISTED",
    "DRY_RUN",
    "SAFE_STOP",
    "TECHNICAL_FAILURE"
  ],
  READY_TO_SUBMIT: ["TECHNICAL_FAILURE"],
  SUBMITTING: ["CONFIRMATION_UNCERTAIN"],
  CONFIRMED: ["BOOKED", "WAITLISTED", "CONFIRMATION_UNCERTAIN"]
};

const transitionsToStage: Readonly<
  Record<(typeof executionStages)[number], readonly ExecutionStage[]>
> = {
  STARTING: [],
  VALIDATED: ["VALIDATED"],
  READY_TO_SUBMIT: ["VALIDATED", "READY_TO_SUBMIT"],
  SUBMITTING: ["VALIDATED", "READY_TO_SUBMIT", "SUBMITTING"],
  CONFIRMED: ["VALIDATED", "READY_TO_SUBMIT", "SUBMITTING", "CONFIRMED"]
};

const stageOutcomeCases: readonly Readonly<[ResultStage, Outcome, boolean]>[] =
  executionStages.flatMap((stage) =>
    outcomes.map((outcome): readonly [ResultStage, Outcome, boolean] => [
      stage,
      outcome,
      validOutcomesByStage[stage].includes(outcome)
    ])
  );

function dependencies(
  execute: (context: ExecutionContext) => Promise<BookingResult>
) {
  const release = vi.fn(async () => ({ released: true as const }));
  const acquireLock = vi.fn(async () => ({ release }));
  const emitResult = vi.fn(async () => undefined);
  return { execute, acquireLock, emitResult, release };
}

it.each(stageOutcomeCases)(
  "enforces returned %s/%s stage-result coherence (valid: %s)",
  async (stage, outcome, valid) => {
    const candidate = resultForOutcome(outcome);
    const selectedArgs = {
      ...args,
      input: {
        ...args.input,
        dry_run: outcome === "DRY_RUN" && stage === "VALIDATED"
      }
    };
    const deps = dependencies(async (context) => {
      for (const next of transitionsToStage[stage]) {
        await context.advance(next);
      }
      return candidate;
    });

    const exit = await runCli(selectedArgs, deps);
    const emitted = JSON.parse(
      (deps.emitResult.mock.calls as unknown as [[string]])[0][0]
    ) as BookingResult;
    if (valid) {
      expect(exit).toBe(candidate.exit_code);
      expect(emitted).toEqual(candidate);
    } else if (stage === "SUBMITTING" || stage === "CONFIRMED") {
      expect(exit).toBe(40);
      expect(emitted).toEqual(resultForOutcome("CONFIRMATION_UNCERTAIN"));
    } else {
      expect(exit).toBe(30);
      expect(emitted).toEqual(resultForOutcome("TECHNICAL_FAILURE"));
    }
  }
);

it("executes identical invocations independently instead of replaying local state", async () => {
  const execute = vi.fn(async (context: ExecutionContext) => {
    await context.advance("VALIDATED");
    return result;
  });
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
      {
        execute: async (context) => {
          await context.advance("VALIDATED");
          return result;
        },
        emitResult: async () => undefined
      }
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

it("rejects submission-stage transitions for dry runs and releases the lock", async () => {
  const dryRunArgs = {
    ...args,
    input: { ...args.input, dry_run: true }
  };
  const deps = dependencies(async (context) => {
    await context.advance("VALIDATED");
    await context.advance("READY_TO_SUBMIT");
    await context.advance("SUBMITTING");
    throw new Error("synthetic failure");
  });

  expect(await runCli(dryRunArgs, deps)).toBe(30);
  expect(deps.emitResult).toHaveBeenCalledOnce();
  const bytes = (deps.emitResult.mock.calls as unknown as [[string]])[0][0];
  expect(JSON.parse(bytes)).toMatchObject({
    outcome: "TECHNICAL_FAILURE",
    action_submitted: false
  });
  expect(deps.release).toHaveBeenCalledOnce();
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

it("does not replace complete stdout when final lock release fails", async () => {
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
  ).toBe(0);
  expect(
    JSON.parse((emitResult.mock.calls as unknown as [[string]])[0][0])
  ).toMatchObject({ outcome: "BOOKED" });
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
      ...dependencies(async (context) => {
        await context.advance("VALIDATED");
        return result;
      }),
      createLogger
    })
  ).toBe(20);
  expect(createLogger).not.toHaveBeenCalled();
});

it("initializes requested logging under the lock before browser work and records validated arguments", async () => {
  const calls: string[] = [];
  const events: DebugEvent[] = [];
  const createLogger = vi.fn(async () => ({
    append: async (event: DebugEvent) => {
      if (events.length === 0) calls.push("logger");
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
        execute: async (context) => {
          calls.push("browser");
          await context.advance("VALIDATED");
          return result;
        },
        emitResult: async () => undefined
      }
    )
  ).toBe(20);
  expect(createLogger).toHaveBeenCalledOnce();
  expect(createLogger).toHaveBeenCalledWith(
    expect.any(Object),
    expect.objectContaining({ version: APPLICATION_VERSION })
  );
  expect(calls).toEqual(["lock", "logger", "browser"]);
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
  const release = vi.fn(async () => ({ released: true as const }));
  acquireLock.mockResolvedValue({ release });
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
  expect(acquireLock).toHaveBeenCalledOnce();
  expect(release).toHaveBeenCalledOnce();
  expect(execute).not.toHaveBeenCalled();
  expect(
    JSON.parse((emitResult.mock.calls as unknown as [[string]])[0][0])
  ).toMatchObject({
    outcome: "TECHNICAL_FAILURE",
    action_submitted: false
  });
});

it("records a projected workflow exception event when debug is enabled", async () => {
  const events: DebugEvent[] = [];
  const emitResult = vi.fn(async () => undefined);
  expect(
    await runCli(
      { ...args, debug: true },
      {
        createLogger: async () => ({
          append: async (event) => {
            events.push(event);
          }
        }),
        acquireLock: async () => ({
          release: async () => ({ released: true as const })
        }),
        bookingBrowser: async () => {
          throw new Error("synthetic browser failure");
        },
        emitResult
      }
    )
  ).toBe(30);
  expect(events).toContainEqual(
    expect.objectContaining({
      event: "workflow.failed",
      data: {
        exception: expect.objectContaining({
          name: "Error",
          message: "synthetic browser failure"
        })
      }
    })
  );
});

it("stops cause projection at a page-control boundary after submission", async () => {
  const privateCause =
    'locator.click: <button value="private checkout state">Complete booking</button>';
  const pageError = new Error("Booking page control is unavailable.", {
    cause: new Error(privateCause)
  });
  pageError.name = "BookingPageControlError";
  const events: DebugEvent[] = [];

  expect(
    await runCli(
      { ...args, debug: true },
      {
        createLogger: async () => ({
          append: async (event) => {
            events.push(event);
          }
        }),
        acquireLock: async () => ({
          release: async () => ({ released: true as const })
        }),
        execute: async (context) => {
          await context.advance("VALIDATED");
          await context.advance("READY_TO_SUBMIT");
          await context.advance("SUBMITTING");
          throw pageError;
        },
        emitResult: async () => undefined
      }
    )
  ).toBe(40);

  const diagnostic = JSON.stringify(events);
  expect(diagnostic).toContain("Booking page control is unavailable.");
  expect(diagnostic).not.toContain(privateCause);
  expect(diagnostic).not.toContain("private checkout state");
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
