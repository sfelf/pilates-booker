import type { Stats } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  link,
  open,
  readFile,
  stat,
  unlink,
  type FileHandle
} from "node:fs/promises";
import { dirname } from "node:path";

import {
  createProcessIdentityProvider,
  type ProcessIdentityProvider
} from "./process-identity.js";

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
  readFile(path: string): Promise<string>;
  statFile(handle: FileHandle): Promise<Stats>;
  close(handle: FileHandle): Promise<void>;
  stat(path: string): Promise<Stats>;
  link(existingPath: string, newPath: string): Promise<void>;
  unlink(path: string): Promise<void>;
}>;
export type LockEnvironment = Readonly<{
  pid: number;
  createToken(): string;
  processIdentity: ProcessIdentityProvider;
}>;

const defaultLockOperations: LockOperations = {
  writeFile: (handle, contents) => handle.writeFile(contents, "utf8"),
  readFile: (path) => readFile(path, "utf8"),
  statFile: (handle) => handle.stat(),
  close: (handle) => handle.close(),
  stat,
  link,
  unlink
};

const defaultLockEnvironment: LockEnvironment = {
  pid: process.pid,
  createToken: randomUUID,
  processIdentity: createProcessIdentityProvider()
};

type LockMetadata = Readonly<{
  version: 2;
  pid: number;
  process_start: string;
  instance_token: string;
}>;

export const ensureDirectory: DirectoryInitializer = async (path) => {
  await mkdir(path, { recursive: true, mode: 0o700 });
};

async function removeOwnedLockPath(
  path: string,
  operations: LockOperations,
  acquired?: Stats,
  recoveryClaimHeld = false
): Promise<LockReleaseResult> {
  const recoveryPath = `${path}.recovery`;
  if (acquired !== undefined) {
    if (!recoveryClaimHeld) {
      try {
        await operations.link(path, recoveryPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return { released: true };
        }
        return { released: false, stage: "stat" };
      }
    }
    try {
      const claimed = await operations.stat(recoveryPath);
      let current: Stats;
      try {
        current = await operations.stat(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          await operations.unlink(recoveryPath).catch(() => undefined);
          return { released: true };
        }
        return { released: false, stage: "stat" };
      }
      if (!sameFile(claimed, acquired) || !sameFile(current, acquired)) {
        await operations.unlink(recoveryPath).catch(() => undefined);
        return { released: true };
      }
    } catch {
      return { released: false, stage: "stat" };
    }
  }
  try {
    await operations.unlink(path);
  } catch {
    return { released: false, stage: "unlink" };
  }
  if (acquired !== undefined) {
    try {
      await operations.unlink(recoveryPath);
    } catch {
      return { released: false, stage: "unlink" };
    }
  }
  return { released: true };
}

async function removeDirectOwnedLockPath(
  path: string,
  operations: LockOperations,
  acquired: Stats
): Promise<void> {
  try {
    const current = await operations.stat(path);
    if (sameFile(current, acquired)) await operations.unlink(path);
  } catch {
    // The caller is already handling an acquisition failure.
  }
}

export async function acquireProfileLock(
  path: string,
  initializeDirectory: DirectoryInitializer = ensureDirectory,
  operations: LockOperations = defaultLockOperations,
  environment: LockEnvironment = defaultLockEnvironment
): Promise<ProfileLock> {
  await initializeDirectory(dirname(path));
  const currentProcess = await environment.processIdentity.identify(
    environment.pid
  );
  if (currentProcess.kind !== "found") {
    throw new Error("current process identity is unavailable");
  }
  const metadata: LockMetadata = {
    version: 2,
    pid: environment.pid,
    process_start: currentProcess.identity,
    instance_token: environment.createToken()
  };
  if (!isLockMetadata(metadata)) {
    throw new Error("current process identity is unavailable");
  }

  let handle;
  let recoveryClaimHeld = false;
  if (!(await pathIsAbsent(`${path}.recovery`, operations))) {
    throw new LockUnavailableError();
  }
  try {
    handle = await open(path, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
    recoveryClaimHeld = await claimStaleLock(
      path,
      operations,
      environment.processIdentity,
      currentProcess.identity
    );
    if (!recoveryClaimHeld) throw new LockUnavailableError();
    try {
      handle = await open(path, "wx", 0o600);
    } catch (retryError) {
      await operations.unlink(`${path}.recovery`).catch(() => undefined);
      if ((retryError as NodeJS.ErrnoException).code === "EEXIST") {
        throw new LockUnavailableError();
      }
      throw retryError;
    }
  }

  let acquired;
  let blockedByRecovery = false;
  try {
    acquired = await operations.statFile(handle);
    if (
      !recoveryClaimHeld &&
      !(await pathIsAbsent(`${path}.recovery`, operations))
    ) {
      blockedByRecovery = true;
      await operations.close(handle);
      await removeDirectOwnedLockPath(path, operations, acquired);
      throw new LockUnavailableError();
    }
    await operations.writeFile(handle, `${JSON.stringify(metadata)}\n`);
  } catch (error) {
    await operations.close(handle).catch(() => undefined);
    if (acquired !== undefined) {
      if (recoveryClaimHeld || blockedByRecovery) {
        await removeDirectOwnedLockPath(path, operations, acquired);
      } else {
        await removeOwnedLockPath(path, operations, acquired);
      }
    }
    if (recoveryClaimHeld) {
      await operations.unlink(`${path}.recovery`).catch(() => undefined);
    }
    throw error;
  }
  if (recoveryClaimHeld) {
    try {
      await operations.unlink(`${path}.recovery`);
    } catch {
      await operations.close(handle).catch(() => undefined);
      await removeDirectOwnedLockPath(path, operations, acquired);
      throw new Error("runtime recovery claim cleanup failed");
    }
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

async function claimStaleLock(
  path: string,
  operations: LockOperations,
  processIdentity: ProcessIdentityProvider,
  currentIdentity: string
): Promise<boolean> {
  const recoveryPath = `${path}.recovery`;
  let contents: string;
  let claimCreated = false;
  try {
    await operations.link(path, recoveryPath);
    claimCreated = true;
    const claimed = await operations.stat(recoveryPath);
    const current = await operations.stat(path);
    if (!sameFile(claimed, current) || claimed.size > 1024) {
      await operations.unlink(recoveryPath).catch(() => undefined);
      return false;
    }
    contents = await operations.readFile(recoveryPath);
  } catch {
    if (claimCreated) {
      await operations.unlink(recoveryPath).catch(() => undefined);
    }
    return false;
  }
  const metadata = parseLockMetadata(contents);
  if (
    metadata === undefined ||
    identityPlatform(metadata.process_start) !==
      identityPlatform(currentIdentity)
  ) {
    await operations.unlink(recoveryPath).catch(() => undefined);
    return false;
  }
  const owner = await processIdentity.identify(metadata.pid);
  if (
    owner.kind === "unknown" ||
    (owner.kind === "found" && owner.identity === metadata.process_start)
  ) {
    await operations.unlink(recoveryPath).catch(() => undefined);
    return false;
  }

  try {
    await operations.unlink(path);
  } catch {
    await operations.unlink(recoveryPath).catch(() => undefined);
    return false;
  }
  return true;
}

async function pathIsAbsent(
  path: string,
  operations: LockOperations
): Promise<boolean> {
  try {
    await operations.stat(path);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    return false;
  }
}

function sameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function parseLockMetadata(contents: string): LockMetadata | undefined {
  try {
    const parsed: unknown = JSON.parse(contents);
    return isLockMetadata(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function identityPlatform(identity: string): string | undefined {
  return identity.match(/^(linux|darwin|win32):/u)?.[1];
}

function isLockMetadata(value: unknown): value is LockMetadata {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 4 ||
    record.version !== 2 ||
    !Number.isSafeInteger(record.pid) ||
    (record.pid as number) <= 0 ||
    typeof record.process_start !== "string" ||
    typeof record.instance_token !== "string"
  ) {
    return false;
  }
  return (
    /^(?:linux:[1-9]\d*|darwin:[1-9]\d*|win32:[1-9]\d*)$/u.test(
      record.process_start
    ) &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      record.instance_token
    )
  );
}
