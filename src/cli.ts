import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import type {
  BookingPolicy,
  BookingRequest,
  BookingResult,
  JournalState
} from "./contracts.js";
import { writeJsonAtomic } from "./atomic-json.js";
import type { BookingBrowser } from "./booking-page.js";
import { executeBookingWorkflow } from "./booking-workflow.js";
import { advanceJournal, readJournal } from "./journal.js";
import {
  acquireProfileLock,
  type LockReleaseResult,
  type ProfileLock
} from "./lock.js";
import { validateResultForRequest } from "./result-validator.js";
import { writeResultToStdout, type ResultEmitter } from "./result-output.js";
import { resolveRuntimePaths } from "./runtime-paths.js";
import { RuntimeCoordinator } from "./runtime-coordinator.js";
import type { ResultReadStatus } from "./runtime-coordinator.js";
import { loadPolicy as loadPolicyFile } from "./policy.js";

export type ExecutionContext = Readonly<{
  request: BookingRequest;
  policy: BookingPolicy;
  profileDir: string;
  advance(state: Exclude<JournalState, "INITIALIZED">): Promise<void>;
}>;

export type CliExecutor = (context: ExecutionContext) => Promise<BookingResult>;

export const CLI_FAILURE_DIAGNOSTIC = "Booking command failed." as const;
export type CliDiagnostic = typeof CLI_FAILURE_DIAGNOSTIC;

export type CliDependencies = Readonly<{
  baseDir?: string;
  cwd?: string;
  loadPolicy?(path: string): Promise<BookingPolicy>;
  loadRequest(path: string): Promise<unknown>;
  validateRequest(value: unknown, policy: BookingPolicy): BookingRequest;
  execute?: CliExecutor;
  bookingBrowser?: BookingBrowser;
  acquireLock?(path: string): Promise<ProfileLock>;
  emitResult?: ResultEmitter;
  reportDiagnostic?(diagnostic: CliDiagnostic): void;
}>;

function reportCliFailure(dependencies: CliDependencies): 30 {
  try {
    dependencies.reportDiagnostic?.(CLI_FAILURE_DIAGNOSTIC);
  } catch {
    // A diagnostic transport failure cannot expose the underlying error.
  }
  return 30;
}

async function readResult(
  path: string,
  request: BookingRequest
): Promise<ResultReadStatus> {
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { status: "missing" };
    }
    return { status: "failure" };
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { status: "invalid" };
  }

  if (validateResultForRequest(value, request)) {
    return { status: "valid", result: value, bytes: raw };
  }
  const requestId = inspectionRequestId(value);
  return requestId === undefined
    ? { status: "invalid" }
    : { status: "invalid", inspectionRequestId: requestId };
}

function inspectionRequestId(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const requestId = (value as Record<string, unknown>).request_id;
  return typeof requestId === "string" ? requestId : undefined;
}

export async function publishResult(
  path: string,
  result: BookingResult,
  request: BookingRequest,
  readFinalized: (path: string) => Promise<string> = (selectedPath) =>
    readFile(selectedPath, "utf8")
): Promise<string> {
  await writeJsonAtomic(path, result, (value) =>
    validateResultForRequest(value, request)
  );
  const bytes = await readFinalized(path);
  let value: unknown;
  try {
    value = JSON.parse(bytes);
  } catch {
    throw new Error("finalized result is invalid");
  }
  if (
    bytes !== `${JSON.stringify(value)}\n` ||
    !validateResultForRequest(value, request) ||
    !isDeepStrictEqual(value, result)
  ) {
    throw new Error("finalized result is invalid");
  }
  return bytes;
}

export async function runCli(
  argv: readonly string[],
  dependencies: CliDependencies
): Promise<number> {
  if (
    argv.length !== 3 ||
    argv[0] !== "--policy" ||
    argv[1] === "" ||
    argv[2] === ""
  ) {
    return reportCliFailure(dependencies);
  }
  let policyPath: string;
  try {
    policyPath = isAbsolute(argv[1]!)
      ? argv[1]!
      : resolve(dependencies.cwd ?? process.cwd(), argv[1]!);
  } catch {
    return reportCliFailure(dependencies);
  }
  const loadPolicy = dependencies.loadPolicy ?? loadPolicyFile;
  let policy: BookingPolicy;
  let request: BookingRequest;
  try {
    policy = await loadPolicy(policyPath);
    const raw = await dependencies.loadRequest(argv[2]!);
    request = dependencies.validateRequest(raw, policy);
  } catch {
    return reportCliFailure(dependencies);
  }
  let paths;
  try {
    paths = resolveRuntimePaths(dependencies.baseDir, request.request_id);
  } catch {
    return reportCliFailure(dependencies);
  }
  const acquireLock = dependencies.acquireLock ?? acquireProfileLock;
  const lock = await acquireLock(paths.lockFile).catch(() => undefined);
  if (lock === undefined) return reportCliFailure(dependencies);

  const coordinator = new RuntimeCoordinator(request, {
    readJournal: () => readJournal(paths.journalFile),
    writeJournal: (record) => advanceJournal(paths.journalFile, record),
    readResult: () => readResult(paths.resultFile, request),
    writeResult: (result) => publishResult(paths.resultFile, result, request)
  });
  const execute: CliExecutor =
    dependencies.execute ??
    ((context) => executeBookingWorkflow(context, dependencies.bookingBrowser));

  const decision = await coordinator.run(({ request, advance }) =>
    execute({
      request,
      policy,
      profileDir: paths.profileDir,
      advance
    })
  );
  const finalized = await coordinator.finalize(decision);
  let lockRelease: LockReleaseResult | undefined;
  try {
    lockRelease = await lock.release();
  } catch {
    lockRelease = undefined;
  }
  void lockRelease;
  if (finalized.bytes === undefined) {
    return reportCliFailure(dependencies);
  }
  try {
    await (dependencies.emitResult ?? writeResultToStdout)(finalized.bytes);
  } catch {
    return reportCliFailure(dependencies);
  }
  return finalized.result.exit_code;
}
