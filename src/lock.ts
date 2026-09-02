import type { Stats } from "node:fs";
import { mkdir, open, stat, unlink, type FileHandle } from "node:fs/promises";
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
  statFile(handle: FileHandle): Promise<Stats>;
  close(handle: FileHandle): Promise<void>;
  stat(path: string): Promise<Stats>;
  unlink(path: string): Promise<void>;
}>;

const defaultLockOperations: LockOperations = {
  writeFile: (handle, contents) => handle.writeFile(contents, "utf8"),
  statFile: (handle) => handle.stat(),
  close: (handle) => handle.close(),
  stat,
  unlink
};

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
  return { released: true };
}

export async function acquireProfileLock(
  path: string,
  initializeDirectory: DirectoryInitializer = ensureDirectory,
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
