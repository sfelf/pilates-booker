import type { BookingBrowser } from "./booking-page.js";
import { executeBookingWorkflow } from "./booking-workflow.js";
import type { CommandArguments } from "./command-arguments.js";
import {
  RESULT_DETAILS,
  type BookingResult,
  type ExecutionStage
} from "./contracts.js";
import {
  createDebugLogger,
  NOOP_DEBUG_LOGGER,
  type DebugData,
  type DebugLogger,
  type DebugMetadata
} from "./debug-log.js";
import { projectDebugException } from "./debug-exception.js";
import { acquireProfileLock, type ProfileLock } from "./lock.js";
import { validateResultForInput } from "./result-validator.js";
import { writeResultToStdout, type ResultEmitter } from "./result-output.js";
import { resolveRuntimePaths, type RuntimePathsV2 } from "./runtime-paths.js";
import { APPLICATION_VERSION } from "./version.js";

export type ExecutionContext = Readonly<{
  input: CommandArguments["input"];
  profileDir: string;
  advance(stage: ExecutionStage): Promise<void>;
  log(event: string, data?: DebugData): Promise<void>;
}>;

export type CliExecutor = (context: ExecutionContext) => Promise<BookingResult>;

export const CLI_FAILURE_DIAGNOSTIC = "Booking command failed." as const;
export type CliDiagnostic = typeof CLI_FAILURE_DIAGNOSTIC;

export type CliDependencies = Readonly<{
  execute?: CliExecutor;
  bookingBrowser?: BookingBrowser;
  acquireLock?(path: string): Promise<ProfileLock>;
  emitResult?: ResultEmitter;
  createLogger?(
    paths: RuntimePathsV2,
    metadata: DebugMetadata
  ): Promise<DebugLogger>;
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
        details: RESULT_DETAILS.CONFIRMATION_UNCERTAIN
      }
    : {
        schema_version: 2,
        outcome: "TECHNICAL_FAILURE",
        exit_code: 30,
        action_submitted: false,
        confirmation_verified: false,
        safety_checks: incompleteSafetyChecks,
        details: RESULT_DETAILS.TECHNICAL_FAILURE
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
    return emitFreshResult(
      failureResult("STARTING"),
      args,
      dependencies,
      NOOP_DEBUG_LOGGER,
      "STARTING"
    );
  }

  let logger = NOOP_DEBUG_LOGGER;
  if (args.debug) {
    try {
      logger = await (dependencies.createLogger ?? createDebugLogger)(paths, {
        now: () => new Date(),
        pid: process.pid,
        version: APPLICATION_VERSION
      });
      await logger.append({
        event: "command.started",
        stage: "STARTING",
        submission_started: false,
        response_emitted: false,
        data: {
          arguments: {
            booking_url: args.input.booking_url,
            allowed_packages: args.input.allowed_packages,
            permitted_actions: args.input.permitted_actions,
            dry_run: args.input.dry_run,
            runtime: paths.baseDir,
            debug: true
          }
        }
      });
    } catch {
      try {
        await lock.release();
      } catch {
        // Initialization failure remains pre-browser and pre-submission.
      }
      return emitFreshResult(
        failureResult("STARTING"),
        args,
        dependencies,
        NOOP_DEBUG_LOGGER,
        "STARTING"
      );
    }
  }

  let stage: ExecutionStage = "STARTING";
  const context: ExecutionContext = {
    input: args.input,
    profileDir: paths.profileDir,
    advance: async (next) => {
      if (args.input.dry_run && next !== "VALIDATED")
        throw new Error("invalid dry-run execution stage");
      if (transitions[stage] !== next)
        throw new Error("invalid execution stage");
      stage = next;
      await appendEvent(logger, "stage.advanced", stage);
    },
    log: (event, data) => appendEvent(logger, event, stage, data)
  };
  const execute: CliExecutor =
    dependencies.execute ??
    ((selectedContext) =>
      executeBookingWorkflow(selectedContext, dependencies.bookingBrowser));

  let result: BookingResult;
  try {
    result = await execute(context);
    if (
      !validateResultForInput(result, args.input) ||
      !resultMatchesStage(result, stage)
    )
      throw new Error("invalid result");
    await appendEvent(logger, "workflow.completed", stage, resultData(result));
  } catch (error) {
    try {
      await appendEvent(logger, "workflow.failed", stage, {
        exception: projectDebugException(error)
      });
    } catch {
      // The execution stage still determines the safe result.
    }
    result = failureResult(stage);
  }

  return emitFreshResult(result, args, dependencies, logger, stage, lock);
}

async function emitFreshResult(
  result: BookingResult,
  args: CommandArguments,
  dependencies: CliDependencies,
  logger: DebugLogger = NOOP_DEBUG_LOGGER,
  stage: ExecutionStage = "STARTING",
  lock?: ProfileLock
): Promise<number> {
  if (
    !validateResultForInput(result, args.input) ||
    !resultMatchesStage(result, stage)
  ) {
    return reportCliFailure(dependencies);
  }
  let selected = result;
  try {
    await appendEvent(logger, "response.pending", stage);
  } catch {
    selected = failureResult(stage);
    if (
      !validateResultForInput(selected, args.input) ||
      !resultMatchesStage(selected, stage)
    ) {
      return reportCliFailure(dependencies);
    }
  }
  const bytes = `${JSON.stringify(selected)}\n`;
  try {
    await (dependencies.emitResult ?? writeResultToStdout)(bytes);
  } catch {
    try {
      await appendEvent(logger, "response.failed", stage);
    } catch {
      // The fixed diagnostic remains the only available transport.
    }
    try {
      await lock?.release();
    } catch {
      // Preserve the exact stale lock for manual recovery.
    }
    return reportCliFailure(dependencies);
  }
  try {
    await logger.append({
      event: "response.emitted",
      stage,
      submission_started: submissionStarted(stage),
      response_emitted: true
    });
  } catch {
    // Complete stdout is already authoritative for this invocation.
  }
  try {
    await lock?.release();
  } catch {
    // Output is already complete; leave the exact stale lock for manual recovery.
  }
  return selected.exit_code;
}

function appendEvent(
  logger: DebugLogger,
  event: string,
  stage: ExecutionStage,
  data?: DebugData
): Promise<void> {
  return logger.append({
    event,
    stage,
    submission_started: submissionStarted(stage),
    response_emitted: false,
    ...(data === undefined ? {} : { data })
  });
}

function submissionStarted(stage: ExecutionStage): boolean {
  return stage === "SUBMITTING" || stage === "CONFIRMED";
}

function resultMatchesStage(
  result: BookingResult,
  stage: ExecutionStage
): boolean {
  if (stage === "STARTING" || stage === "READY_TO_SUBMIT") {
    return result.outcome === "TECHNICAL_FAILURE";
  }
  if (stage === "VALIDATED") {
    return (
      result.outcome === "ALREADY_BOOKED" ||
      result.outcome === "ALREADY_WAITLISTED" ||
      result.outcome === "DRY_RUN" ||
      result.outcome === "SAFE_STOP" ||
      result.outcome === "TECHNICAL_FAILURE"
    );
  }
  if (stage === "SUBMITTING") {
    return result.outcome === "CONFIRMATION_UNCERTAIN";
  }
  if (stage === "CONFIRMED") {
    return (
      result.outcome === "BOOKED" ||
      result.outcome === "WAITLISTED" ||
      result.outcome === "CONFIRMATION_UNCERTAIN"
    );
  }
  return false;
}

function resultData(result: BookingResult): DebugData {
  return {
    ...(result.observed_class === undefined
      ? {}
      : { observed_class: result.observed_class }),
    ...(result.package_selected === undefined
      ? {}
      : { package_selected: result.package_selected }),
    ...(result.packages_before === undefined
      ? {}
      : { packages_before: result.packages_before }),
    decision: result.outcome
  };
}
