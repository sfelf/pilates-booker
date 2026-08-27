import type { Stats } from "node:fs";
import { open, stat, unlink, type FileHandle } from "node:fs/promises";
import { dirname } from "node:path";

import { ensureDirectoryDurable, syncDirectoryDurable } from "./atomic-json.js";

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
      stage: "close" | "stat" | "unlink" | "sync";
    }>;

export type ProfileLock = Readonly<{
  release(): Promise<LockReleaseResult>;
}>;
export type DirectoryInitializer = (path: string) => Promise<void>;
export type LockOperations = Readonly<{
  writeFile(handle: FileHandle, contents: string): Promise<void>;
  syncFile(handle: FileHandle): Promise<void>;
  statFile(handle: FileHandle): Promise<Stats>;
  close(handle: FileHandle): Promise<void>;
  stat(path: string): Promise<Stats>;
  unlink(path: string): Promise<void>;
  syncDirectory(path: string): Promise<void>;
}>;

const defaultLockOperations: LockOperations = {
  writeFile: (handle, contents) => handle.writeFile(contents, "utf8"),
  syncFile: (handle) => handle.sync(),
  statFile: (handle) => handle.stat(),
  close: (handle) => handle.close(),
  stat,
  unlink,
  syncDirectory: syncDirectoryDurable
};

async function removeLockPathDurably(
  path: string,
  operations: LockOperations,
  acquired?: Stats
): Promise<LockReleaseResult> {
  if (acquired !== undefined) {
    let current: Stats;
    try {
      current = await operations.stat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { released: true };
      }
      return { released: false, stage: "stat" };
    }
    if (current.dev !== acquired.dev || current.ino !== acquired.ino) {
      return { released: true };
    }
  }
  try {
    await operations.unlink(path);
  } catch {
    return { released: false, stage: "unlink" };
  }
  try {
    await operations.syncDirectory(dirname(path));
  } catch {
    return { released: false, stage: "sync" };
  }
  return { released: true };
}

export async function acquireProfileLock(
  path: string,
  initializeDirectory: DirectoryInitializer = ensureDirectoryDurable,
  operations: LockOperations = defaultLockOperations
): Promise<ProfileLock> {
  await initializeDirectory(dirname(path));
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new LockUnavailableError();
    }
    throw error;
  }

  let acquired;
  try {
    acquired = await operations.statFile(handle);
    await operations.writeFile(handle, '{"version":1}\n');
    await operations.syncFile(handle);
  } catch (error) {
    await operations.close(handle).catch(() => undefined);
    if (acquired !== undefined) {
      await removeLockPathDurably(path, operations, acquired);
    }
    throw error;
  }

  let released = false;
  let closed = false;
  let pathRemoved = false;
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
    if (!pathRemoved) {
      let current: Stats;
      try {
        current = await operations.stat(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          released = true;
          return { released: true };
        }
        return { released: false, stage: "stat" };
      }
      if (current.dev !== acquired.dev || current.ino !== acquired.ino) {
        released = true;
        return { released: true };
      }
      try {
        await operations.unlink(path);
      } catch {
        return { released: false, stage: "unlink" };
      }
      pathRemoved = true;
    }
    try {
      await operations.syncDirectory(dirname(path));
    } catch {
      return { released: false, stage: "sync" };
    }
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
