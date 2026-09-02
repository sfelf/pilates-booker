import { chmod, mkdir, open, rename, rm, stat } from "node:fs/promises";

import type {
  ExecutionStage,
  ObservedClass,
  PackageBalance,
  PermittedActions
} from "./contracts.js";
import type { RuntimePathsV2 } from "./runtime-paths.js";
import { projectDebugText } from "./safe-text.js";

const MAX_LOG_BYTES = 1024 * 1024;

export type DebugArguments = Readonly<{
  booking_url: string;
  allowed_packages: readonly string[];
  permitted_actions: PermittedActions;
  dry_run: boolean;
  runtime: string;
  debug: true;
}>;

export type DebugException = Readonly<{
  name?: string;
  message?: string;
  stack?: string;
}>;

export type DebugData = Readonly<{
  arguments?: DebugArguments;
  observed_class?: ObservedClass;
  package_selected?: string | null;
  packages_before?: readonly PackageBalance[];
  decision?: string;
  status_code?: number;
  exception?: DebugException;
}>;

export type DebugEvent = Readonly<{
  event: string;
  stage: ExecutionStage;
  submission_started: boolean;
  response_emitted: boolean;
  data?: DebugData;
}>;

export type DebugLogger = Readonly<{
  append(event: DebugEvent): Promise<void>;
}>;

export type DebugMetadata = Readonly<{
  now(): Date;
  pid: number;
  version: string;
}>;

export const NOOP_DEBUG_LOGGER: DebugLogger = Object.freeze({
  append: async () => undefined
});

export async function createDebugLogger(
  paths: RuntimePathsV2,
  metadata: DebugMetadata
): Promise<DebugLogger> {
  await mkdir(paths.baseDir, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") await chmod(paths.baseDir, 0o700);
  const initial = await open(paths.logFile, "a", 0o600);
  await initial.close();
  if (process.platform !== "win32") await chmod(paths.logFile, 0o600);

  let appends = Promise.resolve();
  return {
    append(event) {
      const operation = appends.then(async () => {
        const record = {
          timestamp: metadata.now().toISOString(),
          pid: metadata.pid,
          version: projectDebugText(metadata.version),
          ...projectEvent(event)
        };
        const bytes = `${JSON.stringify(record)}\n`;
        if (Buffer.byteLength(bytes) > MAX_LOG_BYTES) {
          throw new Error("Debug log record exceeds 1 MiB");
        }
        const existingBytes = await fileSize(paths.logFile);
        if (existingBytes + Buffer.byteLength(bytes) > MAX_LOG_BYTES) {
          await rm(paths.rotatedLogFile, { force: true });
          if (existingBytes > 0)
            await rename(paths.logFile, paths.rotatedLogFile);
        }
        const handle = await open(paths.logFile, "a", 0o600);
        try {
          await handle.writeFile(bytes, "utf8");
        } finally {
          await handle.close();
        }
        if (process.platform !== "win32") await chmod(paths.logFile, 0o600);
      });
      appends = operation.catch(() => undefined);
      return operation;
    }
  };
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}

function projectEvent(event: DebugEvent): DebugEvent {
  return {
    event: projectDebugText(event.event),
    stage: event.stage,
    submission_started: event.submission_started,
    response_emitted: event.response_emitted,
    ...(event.data === undefined ? {} : { data: projectData(event.data) })
  };
}

function projectData(data: DebugData): DebugData {
  return {
    ...(data.arguments === undefined
      ? {}
      : {
          arguments: {
            booking_url: projectDebugText(data.arguments.booking_url),
            allowed_packages:
              data.arguments.allowed_packages.map(projectDebugText),
            permitted_actions: data.arguments.permitted_actions,
            dry_run: data.arguments.dry_run,
            runtime: projectDebugText(data.arguments.runtime),
            debug: true as const
          }
        }),
    ...(data.observed_class === undefined
      ? {}
      : { observed_class: projectObservedClass(data.observed_class) }),
    ...(data.package_selected === undefined
      ? {}
      : {
          package_selected:
            data.package_selected === null
              ? null
              : projectDebugText(data.package_selected)
        }),
    ...(data.packages_before === undefined
      ? {}
      : {
          packages_before: data.packages_before.map((entry) => ({
            name: projectDebugText(entry.name),
            remaining: entry.remaining,
            approved: entry.approved
          }))
        }),
    ...(data.decision === undefined
      ? {}
      : { decision: projectDebugText(data.decision) }),
    ...(Number.isSafeInteger(data.status_code) &&
    data.status_code !== undefined &&
    data.status_code >= 100 &&
    data.status_code <= 599
      ? { status_code: data.status_code }
      : {}),
    ...(data.exception === undefined
      ? {}
      : {
          exception: {
            ...(data.exception.name === undefined
              ? {}
              : { name: projectDebugText(data.exception.name) }),
            ...(data.exception.message === undefined
              ? {}
              : { message: projectDebugText(data.exception.message) }),
            ...(data.exception.stack === undefined
              ? {}
              : { stack: projectDebugText(data.exception.stack) })
          }
        })
  };
}

function projectObservedClass(value: ObservedClass): ObservedClass {
  return {
    name: projectDebugText(value.name),
    instructor: projectDebugText(value.instructor),
    date: projectDebugText(value.date),
    start_time: projectDebugText(value.start_time),
    end_time: projectDebugText(value.end_time),
    timezone: projectDebugText(value.timezone)
  };
}
