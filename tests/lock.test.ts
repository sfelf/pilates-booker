import {
  mkdtemp,
  readFile,
  rename,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import {
  LockUnavailableError,
  acquireProfileLock,
  type LockOperations
} from "../src/lock.js";
import { ensureDirectory } from "../src/atomic-json.js";

const operations = (
  overrides: Partial<LockOperations> = {}
): LockOperations => ({
  writeFile: (handle, contents) => handle.writeFile(contents, "utf8"),
  statFile: (handle) => handle.stat(),
  close: (handle) => handle.close(),
  stat,
  unlink,
  ...overrides
});

const filesystemError = (code: string): NodeJS.ErrnoException =>
  Object.assign(new Error("synthetic private filesystem message"), { code });

describe("acquireProfileLock", () => {
  test("removes the lock when acquisition initialization fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arketa-lock-"));
    const path = join(directory, "run.lock");
    const events: string[] = [];
    const injectedOperations = {
      ...operations({
        close: async (handle) => {
          events.push("close");
          await handle.close();
        },
        unlink: async (removedPath) => {
          events.push("unlink");
          await unlink(removedPath);
        }
      }),
      writeFile: async () => {
        throw filesystemError("EIO");
      },
      statFile: async (handle: Parameters<LockOperations["close"]>[0]) =>
        handle.stat()
    } as LockOperations;

    await expect(
      acquireProfileLock(path, ensureDirectory, injectedOperations)
    ).rejects.toThrow();
    expect(events).toEqual(["close", "unlink"]);
    await expect(readFile(path, "utf8")).rejects.toThrow();
  });

  test("preserves the pathname when acquisition ownership cannot be established", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arketa-lock-"));
    const path = join(directory, "run.lock");

    await expect(
      acquireProfileLock(
        path,
        ensureDirectory,
        operations({
          statFile: async () => {
            throw filesystemError("EIO");
          }
        })
      )
    ).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe("");
  });

  test("does not remove a replacement lock during acquisition cleanup", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arketa-lock-"));
    const path = join(directory, "run.lock");
    const replacementPath = join(directory, "replacement.lock");

    await expect(
      acquireProfileLock(
        path,
        ensureDirectory,
        operations({
          writeFile: async () => {
            throw filesystemError("EIO");
          },
          close: async (handle) => {
            await writeFile(
              replacementPath,
              '{"version":1,"replacement":true}\n'
            );
            await handle.close();
            await unlink(path);
            await rename(replacementPath, path);
          }
        })
      )
    ).rejects.toThrow();
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      version: 1,
      replacement: true
    });
  });

  test("creates the runtime base before creating its lock", async () => {
    const parent = await mkdtemp(join(tmpdir(), "arketa-lock-parent-"));
    const base = join(parent, "private-runtime");
    const path = join(base, "run.lock");
    let initializedBeforeLock = false;

    const lock = await acquireProfileLock(path, async (directory) => {
      await expect(readFile(path, "utf8")).rejects.toThrow();
      await ensureDirectory(directory);
      initializedBeforeLock = true;
    });

    expect(initializedBeforeLock).toBe(true);
    await lock.release();
  });

  test("serializes concurrent release calls", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arketa-lock-"));
    const path = join(directory, "run.lock");
    let unlinkCalls = 0;
    let continueClose!: () => void;
    const closeGate = new Promise<void>((resolve) => {
      continueClose = resolve;
    });
    const lock = await acquireProfileLock(
      path,
      ensureDirectory,
      operations({
        close: async (handle) => {
          await closeGate;
          await handle.close();
        },
        unlink: async (removedPath) => {
          unlinkCalls += 1;
          await unlink(removedPath);
        }
      })
    );

    const first = lock.release();
    const second = lock.release();
    continueClose();

    await expect(Promise.all([first, second])).resolves.toEqual([
      { released: true },
      { released: true }
    ]);
    expect(unlinkCalls).toBe(1);
  });

  test.each([
    [
      "close",
      operations({
        close: async (handle) => {
          await handle.close();
          throw filesystemError("EIO");
        }
      })
    ],
    [
      "stat",
      operations({
        stat: async () => {
          throw filesystemError("EACCES");
        }
      })
    ],
    [
      "unlink",
      operations({
        unlink: async () => {
          throw filesystemError("EPERM");
        }
      })
    ]
  ] as const)(
    "returns the typed %s stage for a release failure",
    async (stage, injectedOperations) => {
      const directory = await mkdtemp(join(tmpdir(), "arketa-lock-"));
      const path = join(directory, "run.lock");
      const lock = await acquireProfileLock(
        path,
        ensureDirectory,
        injectedOperations
      );

      await expect(lock.release()).resolves.toEqual({
        released: false,
        stage
      });
    }
  );

  test("treats only an ENOENT stat failure as an already absent pathname", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arketa-lock-"));
    const path = join(directory, "run.lock");
    const lock = await acquireProfileLock(
      path,
      ensureDirectory,
      operations({
        stat: async () => {
          throw filesystemError("ENOENT");
        }
      })
    );

    await expect(lock.release()).resolves.toEqual({ released: true });
    await expect(lock.release()).resolves.toEqual({ released: true });
  });

  test("does not treat an ENOENT unlink failure as a successful release", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arketa-lock-"));
    const path = join(directory, "run.lock");
    const lock = await acquireProfileLock(
      path,
      ensureDirectory,
      operations({
        unlink: async () => {
          throw filesystemError("ENOENT");
        }
      })
    );

    await expect(lock.release()).resolves.toEqual({
      released: false,
      stage: "unlink"
    });
  });

  test("exclusively acquires and releases a lock without storing paths", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arketa-lock-"));
    const path = join(directory, "run.lock");
    const lock = await acquireProfileLock(path);

    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ version: 1 });
    await expect(acquireProfileLock(path)).rejects.toBeInstanceOf(
      LockUnavailableError
    );

    await lock.release();
    const reacquired = await acquireProfileLock(path);
    await reacquired.release();
  });

  test("diagnoses a stale-looking lock without deleting it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arketa-lock-"));
    const path = join(directory, "run.lock");
    await writeFile(path, '{"version":1}', "utf8");

    await expect(acquireProfileLock(path)).rejects.toThrow(
      "runtime lock is already held"
    );
    expect(await readFile(path, "utf8")).toBe('{"version":1}');
  });
});
