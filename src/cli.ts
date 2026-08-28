import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import type {
  BookingPolicy,
  BookingRequest,
  BookingResult,
  JournalState
} from "./contracts.js";
import { writeJsonAtomic } from "./atomic-json.js";
import { advanceJournal, readJournal } from "./journal.js";
import {
  acquireProfileLock,
  type LockReleaseResult,
  type ProfileLock
} from "./lock.js";
import { validateResult } from "./result-validator.js";
import { resolveRuntimePaths } from "./runtime-paths.js";
import { RuntimeCoordinator } from "./runtime-coordinator.js";
import type { ResultReadStatus } from "./runtime-coordinator.js";
import { loadPolicy as loadPolicyFile } from "./policy.js";

export type ExecutionContext = Readonly<{
  request: BookingRequest;
  policy: BookingPolicy;
  advance(state: Exclude<JournalState, "INITIALIZED">): Promise<void>;
}>;

export type CliDependencies = Readonly<{
  baseDir?: string;
  cwd?: string;
  loadPolicy?(path: string): Promise<BookingPolicy>;
  loadRequest(path: string): Promise<unknown>;
  validateRequest(value: unknown, policy: BookingPolicy): BookingRequest;
  execute(context: ExecutionContext): Promise<BookingResult>;
  acquireLock?(path: string): Promise<ProfileLock>;
}>;

async function readResult(path: string): Promise<ResultReadStatus> {
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

  if (validateResult(value)) return { status: "valid", result: value };
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

async function publishResult(
  path: string,
  result: BookingResult
): Promise<void> {
  await writeJsonAtomic(path, result, validateResult);
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
    return 30;
  }
  let policyPath: string;
  try {
    policyPath = isAbsolute(argv[1]!)
      ? argv[1]!
      : resolve(dependencies.cwd ?? process.cwd(), argv[1]!);
  } catch {
    return 30;
  }
  const loadPolicy = dependencies.loadPolicy ?? loadPolicyFile;
  let policy: BookingPolicy;
  let request: BookingRequest;
  try {
    policy = await loadPolicy(policyPath);
    const raw = await dependencies.loadRequest(argv[2]!);
    request = dependencies.validateRequest(raw, policy);
  } catch {
    return 30;
  }
  let paths;
  try {
    paths = resolveRuntimePaths(dependencies.baseDir);
  } catch {
    return 30;
  }
  const acquireLock = dependencies.acquireLock ?? acquireProfileLock;
  const lock = await acquireLock(paths.lockFile).catch(() => undefined);
  if (lock === undefined) return 30;

  const coordinator = new RuntimeCoordinator(request, {
    readJournal: () => readJournal(paths.journalFile),
    writeJournal: (record) => advanceJournal(paths.journalFile, record),
    readResult: () => readResult(paths.resultFile),
    writeResult: (result) => publishResult(paths.resultFile, result)
  });

  const decision = await coordinator.run(({ request, advance }) =>
    dependencies.execute({ request, policy, advance })
  );
  const finalized = await coordinator.finalize(decision);
  let lockRelease: LockReleaseResult | undefined;
  try {
    lockRelease = await lock.release();
  } catch {
    lockRelease = undefined;
  }
  void lockRelease;
  return finalized.result.exit_code;
}
