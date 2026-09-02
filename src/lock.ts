import type { Stats } from "node:fs";
import { mkdir, lstat, open, unlink, type FileHandle } from "node:fs/promises";
import { dirname } from "node:path";

export class LockUnavailableError extends Error {
  constructor() {
    super("runtime lock is already held");
    this.name = "LockUnavailableError";
  }
}

export type LockReleaseResult =
  | Readonly<{ released: true }>
  | Readonly<{
      released: false;
      stage: "close" | "stat" | "unlink";
    }>;

export type ProfileLock = Readonly<{
  release(): Promise<LockReleaseResult>;
}>;
export type DirectoryInitializer = (path: string) => Promise<void>;
export type LockOperations = Readonly<{
  writeFile(handle: FileHandle, contents: string): Promise<void>;
  openRead(path: string): Promise<FileHandle>;
  read(handle: FileHandle, buffer: Buffer): Promise<number>;
  statFile(handle: FileHandle): Promise<Stats>;
  close(handle: FileHandle): Promise<void>;
  lstat(path: string): Promise<Stats>;
  unlink(path: string): Promise<void>;
}>;
export type PidState = "active" | "absent" | "indeterminate";
export type LockEnvironment = Readonly<{
  pid: number;
  probePid(pid: number): PidState;
}>;

const defaultLockOperations: LockOperations = {
  writeFile: (handle, contents) => handle.writeFile(contents, "utf8"),
  openRead: (path) => open(path, "r"),
  read: async (handle, buffer) =>
    (await handle.read(buffer, 0, buffer.byteLength, 0)).bytesRead,
  statFile: (handle) => handle.stat(),
  close: (handle) => handle.close(),
  lstat,
  unlink
};

const defaultLockEnvironment: LockEnvironment = {
  pid: process.pid,
  probePid: (pid) => {
    try {
      process.kill(pid, 0);
      return "active";
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ESRCH"
        ? "absent"
        : "indeterminate";
    }
  }
};

type LockMetadata = Readonly<{
  version: 2;
  pid: number;
}>;

type InspectedLock = Readonly<{
  contents: string;
  identity: Stats;
}>;

const MAX_LOCK_METADATA_BYTES = 1024;

export const ensureDirectory: DirectoryInitializer = async (path) => {
  await mkdir(path, { recursive: true, mode: 0o700 });
};

async function removeOwnedLockPath(
  path: string,
  operations: LockOperations,
  acquired?: Stats
): Promise<LockReleaseResult> {
  if (acquired !== undefined) {
    let current: Stats;
    try {
      current = await operations.lstat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { released: true };
      }
      return { released: false, stage: "stat" };
    }
    if (!sameFile(current, acquired)) return { released: true };
  }
  try {
    await operations.unlink(path);
  } catch {
    return { released: false, stage: "unlink" };
  }
  return { released: true };
}

export async function acquireProfileLock(
  path: string,
  initializeDirectory: DirectoryInitializer = ensureDirectory,
  operations: LockOperations = defaultLockOperations,
  environment: LockEnvironment = defaultLockEnvironment
): Promise<ProfileLock> {
  await initializeDirectory(dirname(path));
  if (!validPid(environment.pid)) {
    throw new Error("current process identifier is unavailable");
  }
  const metadata: LockMetadata = { version: 2, pid: environment.pid };

  let handle: FileHandle;
  try {
    handle = await open(path, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (!(await removeConclusiveStaleLock(path, operations, environment))) {
      throw new LockUnavailableError();
    }
    try {
      handle = await open(path, "wx", 0o600);
    } catch (retryError) {
      if ((retryError as NodeJS.ErrnoException).code === "EEXIST") {
        throw new LockUnavailableError();
      }
      throw retryError;
    }
  }

  let acquired: Stats | undefined;
  try {
    acquired = await operations.statFile(handle);
    await operations.writeFile(handle, `${JSON.stringify(metadata)}\n`);
  } catch (error) {
    await operations.close(handle).catch(() => undefined);
    if (acquired !== undefined) {
      await removeOwnedLockPath(path, operations, acquired);
    }
    throw error;
  }

  let released = false;
  let closed = false;
  let releaseInFlight: Promise<LockReleaseResult> | undefined;
  const performRelease = async (): Promise<LockReleaseResult> => {
    if (released) return { released: true };
    if (!closed) {
      try {
        await operations.close(handle);
      } catch {
        return { released: false, stage: "close" };
      }
      closed = true;
    }
    const result = await removeOwnedLockPath(path, operations, acquired);
    if (!result.released) return result;
    released = true;
    return { released: true };
  };

  return {
    release() {
      if (released) return Promise.resolve({ released: true });
      if (releaseInFlight !== undefined) return releaseInFlight;
      releaseInFlight = performRelease().finally(() => {
        releaseInFlight = undefined;
      });
      return releaseInFlight;
    }
  };
}

async function removeConclusiveStaleLock(
  path: string,
  operations: LockOperations,
  environment: LockEnvironment
): Promise<boolean> {
  const inspected = await inspectLock(path, operations);
  if (inspected === undefined) return false;
  const first = parseLockMetadata(inspected.contents);
  if (first === undefined || environment.probePid(first.pid) !== "absent") {
    return false;
  }

  try {
    const current = await inspectLock(path, operations);
    if (current === undefined) return false;
    const second = parseLockMetadata(current.contents);
    if (
      second === undefined ||
      second.pid !== first.pid ||
      !sameFile(current.identity, inspected.identity) ||
      environment.probePid(second.pid) !== "absent"
    ) {
      return false;
    }
    await operations.unlink(path);
    return true;
  } catch {
    return false;
  }
}

async function inspectLock(
  path: string,
  operations: LockOperations
): Promise<InspectedLock | undefined> {
  let handle: FileHandle | undefined;
  let inspected: InspectedLock | undefined;
  try {
    const identity = await operations.lstat(path);
    if (!identity.isFile() || identity.size > MAX_LOCK_METADATA_BYTES) {
      return undefined;
    }
    handle = await operations.openRead(path);
    const opened = await operations.statFile(handle);
    if (
      !opened.isFile() ||
      opened.size > MAX_LOCK_METADATA_BYTES ||
      !sameFile(opened, identity)
    ) {
      return undefined;
    }
    const buffer = Buffer.alloc(MAX_LOCK_METADATA_BYTES + 1);
    const bytesRead = await operations.read(handle, buffer);
    if (bytesRead > MAX_LOCK_METADATA_BYTES || bytesRead !== opened.size) {
      return undefined;
    }
    inspected = {
      contents: buffer.subarray(0, bytesRead).toString("utf8"),
      identity
    };
  } catch {
    return undefined;
  } finally {
    if (handle !== undefined) {
      try {
        await operations.close(handle);
      } catch {
        inspected = undefined;
      }
    }
  }
  if (inspected === undefined) return undefined;
  try {
    const current = await operations.lstat(path);
    if (
      !current.isFile() ||
      current.size > MAX_LOCK_METADATA_BYTES ||
      !sameFile(current, inspected.identity)
    ) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return inspected;
}

function parseLockMetadata(contents: string): LockMetadata | undefined {
  try {
    const parsed: unknown = JSON.parse(contents);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return undefined;
    }
    const record = parsed as Record<string, unknown>;
    return Object.keys(record).length === 2 &&
      record.version === 2 &&
      validPid(record.pid)
      ? { version: 2, pid: record.pid }
      : undefined;
  } catch {
    return undefined;
  }
}

function validPid(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function sameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}
