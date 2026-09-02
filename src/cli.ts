import type { BookingBrowser } from "./booking-page.js";
import { executeBookingWorkflow } from "./booking-workflow.js";
import type { CommandArguments } from "./command-arguments.js";
import type { BookingResult, ExecutionStage } from "./contracts.js";
import { acquireProfileLock, type ProfileLock } from "./lock.js";
import { validateResultForInput } from "./result-validator.js";
import { writeResultToStdout, type ResultEmitter } from "./result-output.js";
import { resolveRuntimePaths } from "./runtime-paths.js";

export type ExecutionContext = Readonly<{
  input: CommandArguments["input"];
  profileDir: string;
  advance(stage: ExecutionStage): Promise<void>;
  log(event: string, data?: Readonly<Record<string, unknown>>): Promise<void>;
}>;

export type CliExecutor = (context: ExecutionContext) => Promise<BookingResult>;

export const CLI_FAILURE_DIAGNOSTIC = "Booking command failed." as const;
export type CliDiagnostic = typeof CLI_FAILURE_DIAGNOSTIC;

export type CliDependencies = Readonly<{
  execute?: CliExecutor;
  bookingBrowser?: BookingBrowser;
  acquireLock?(path: string): Promise<ProfileLock>;
  emitResult?: ResultEmitter;
  reportDiagnostic?(diagnostic: CliDiagnostic): void;
}>;

const incompleteSafetyChecks = {
  approved_package_verified: false,
  no_charge: false,
  cancellation_policy_accepted: false
} as const;

const completedSafetyChecks = {
  approved_package_verified: true,
  no_charge: true,
  cancellation_policy_accepted: true
} as const;

const transitions: Readonly<Partial<Record<ExecutionStage, ExecutionStage>>> = {
  STARTING: "VALIDATED",
  VALIDATED: "READY_TO_SUBMIT",
  READY_TO_SUBMIT: "SUBMITTING",
  SUBMITTING: "CONFIRMED"
};

function reportCliFailure(dependencies: CliDependencies): 30 {
  try {
    dependencies.reportDiagnostic?.(CLI_FAILURE_DIAGNOSTIC);
  } catch {
    // A diagnostic transport failure cannot expose the underlying error.
  }
  return 30;
}

function failureResult(stage: ExecutionStage): BookingResult {
  return stage === "SUBMITTING" || stage === "CONFIRMED"
    ? {
        schema_version: 2,
        outcome: "CONFIRMATION_UNCERTAIN",
        exit_code: 40,
        action_submitted: true,
        confirmation_verified: false,
        safety_checks: completedSafetyChecks,
        details: "Booking confirmation is uncertain."
      }
    : {
        schema_version: 2,
        outcome: "TECHNICAL_FAILURE",
        exit_code: 30,
        action_submitted: false,
        confirmation_verified: false,
        safety_checks: incompleteSafetyChecks,
        details: "Runtime operation failed."
      };
}

export async function runCli(
  args: CommandArguments,
  dependencies: CliDependencies = {}
): Promise<number> {
  let paths;
  try {
    paths = resolveRuntimePaths(args.runtimeDir);
  } catch {
    return reportCliFailure(dependencies);
  }

  const acquireLock = dependencies.acquireLock ?? acquireProfileLock;
  let lock: ProfileLock;
  try {
    lock = await acquireLock(paths.lockFile);
  } catch {
    return emitFreshResult(failureResult("STARTING"), args, dependencies);
  }

  let stage: ExecutionStage = "STARTING";
  const context: ExecutionContext = {
    input: args.input,
    profileDir: paths.profileDir,
    advance: async (next) => {
      if (transitions[stage] !== next)
        throw new Error("invalid execution stage");
      stage = next;
    },
    log: async () => undefined
  };
  const execute: CliExecutor =
    dependencies.execute ??
    ((selectedContext) =>
      executeBookingWorkflow(selectedContext, dependencies.bookingBrowser));

  let result: BookingResult;
  try {
    result = await execute(context);
    if (!validateResultForInput(result, args.input))
      throw new Error("invalid result");
  } catch {
    result = failureResult(stage);
  }

  try {
    const released = await lock.release();
    if (!released.released) result = failureResult(stage);
  } catch {
    result = failureResult(stage);
  }
  return emitFreshResult(result, args, dependencies);
}

async function emitFreshResult(
  result: BookingResult,
  args: CommandArguments,
  dependencies: CliDependencies
): Promise<number> {
  if (!validateResultForInput(result, args.input)) {
    return reportCliFailure(dependencies);
  }
  try {
    await (dependencies.emitResult ?? writeResultToStdout)(
      `${JSON.stringify(result)}\n`
    );
  } catch {
    return reportCliFailure(dependencies);
  }
  return result.exit_code;
}
