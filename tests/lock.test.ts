import {
  mkdtemp,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  LockUnavailableError,
  acquireProfileLock,
  ensureDirectory,
  type LockEnvironment,
  type LockOperations
} from "../src/lock.js";

const operations = (
  overrides: Partial<LockOperations> = {}
): LockOperations => ({
  writeFile: (handle, contents) => handle.writeFile(contents, "utf8"),
  readFile: (path) => readFile(path, "utf8"),
  statFile: (handle) => handle.stat(),
  close: (handle) => handle.close(),
  stat,
  unlink,
  ...overrides
});

const environment = (
  overrides: Partial<LockEnvironment> = {}
): LockEnvironment => ({
  pid: 42,
  probePid: () => "absent",
  ...overrides
});

const lockContents = (pid = 77): string =>
  `${JSON.stringify({ version: 2, pid })}\n`;

const filesystemError = (code: string): NodeJS.ErrnoException =>
  Object.assign(new Error("synthetic private filesystem message"), { code });

afterEach(() => vi.restoreAllMocks());

describe("acquireProfileLock", () => {
  test("creates the runtime base and writes only its PID", async () => {
    const parent = await mkdtemp(join(tmpdir(), "arketa-lock-parent-"));
    const path = join(parent, "private-runtime", "run.lock");
    const lock = await acquireProfileLock(
      path,
      ensureDirectory,
      operations(),
      environment()
    );

    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      version: 2,
      pid: 42
    });
    await lock.release();
  });

  test.each(["active", "indeterminate"] as const)(
    "preserves a lock whose PID probe is %s",
    async (state) => {
      const directory = await mkdtemp(join(tmpdir(), "arketa-lock-"));
      const path = join(directory, "run.lock");
      const contents = lockContents();
      await writeFile(path, contents, "utf8");
      const probePid = vi.fn(() => state);

      await expect(
        acquireProfileLock(
          path,
          ensureDirectory,
          operations(),
          environment({ probePid })
        )
      ).rejects.toBeInstanceOf(LockUnavailableError);
      expect(probePid).toHaveBeenCalledWith(77);
      expect(await readFile(path, "utf8")).toBe(contents);
    }
  );

  test("recovers a lock whose PID is conclusively absent", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arketa-lock-"));
    const path = join(directory, "run.lock");
    await writeFile(path, lockContents(), "utf8");

    const lock = await acquireProfileLock(
      path,
      ensureDirectory,
      operations(),
      environment()
    );

    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      version: 2,
      pid: 42
    });
    expect(await readdir(directory)).toEqual(["run.lock"]);
    await lock.release();
  });

  test.each([
    '{"version":1}\n',
    "",
    "{",
    lockContents(0),
    lockContents(Number.MAX_SAFE_INTEGER + 1),
    '{"version":2,"pid":77,"extra":true}\n',
    JSON.stringify(lockContents()),
    `${encodeURIComponent(lockContents())}\n`,
    `${encodeURIComponent(encodeURIComponent(lockContents()))}\n`,
    "x".repeat(1025)
  ])(
    "preserves invalid metadata without projecting it: %j",
    async (contents) => {
      const directory = await mkdtemp(join(tmpdir(), "arketa-lock-"));
      const path = join(directory, "run.lock");
      await writeFile(path, contents, "utf8");

      const failure = await acquireProfileLock(
        path,
        ensureDirectory,
        operations(),
        environment()
      ).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(LockUnavailableError);
      expect((failure as Error).message).toBe("runtime lock is already held");
      if (contents.length > 0) {
        expect((failure as Error).message).not.toContain(contents);
      }
      expect(await readFile(path, "utf8")).toBe(contents);
    }
  );

  test("preserves an unreadable lock", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arketa-lock-"));
    const path = join(directory, "run.lock");
    await writeFile(path, lockContents(), "utf8");

    await expect(
      acquireProfileLock(
        path,
        ensureDirectory,
        operations({
          readFile: async () => {
            throw filesystemError("EACCES");
          }
        }),
        environment()
      )
    ).rejects.toBeInstanceOf(LockUnavailableError);
    expect(await readFile(path, "utf8")).toBe(lockContents());
  });

  test("preserves a non-regular lock without reading its metadata", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arketa-lock-"));
    const path = join(directory, "run.lock");
    const contents = lockContents();
    await writeFile(path, contents, "utf8");
    let metadataRead = false;

    await expect(
      acquireProfileLock(
        path,
        ensureDirectory,
        operations({
          readFile: async (readPath) => {
            metadataRead = true;
            return readFile(readPath, "utf8");
          },
          stat: async (statPath) => {
            const details = await stat(statPath);
            return Object.assign(details, { isFile: () => false });
          }
        }),
        environment()
      )
    ).rejects.toBeInstanceOf(LockUnavailableError);
    expect(metadataRead).toBe(false);
    expect(await readFile(path, "utf8")).toBe(contents);
  });

  test("preserves a lock that grows past the size limit during revalidation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arketa-lock-"));
    const path = join(directory, "run.lock");
    const oversized = `${lockContents()}${" ".repeat(1025)}`;
    await writeFile(path, lockContents(), "utf8");
    let reads = 0;

    await expect(
      acquireProfileLock(
        path,
        ensureDirectory,
        operations({
          readFile: async (readPath) => {
            reads += 1;
            if (reads === 2) await writeFile(path, oversized, "utf8");
            return readFile(readPath, "utf8");
          }
        }),
        environment()
      )
    ).rejects.toBeInstanceOf(LockUnavailableError);
    expect(await readFile(path, "utf8")).toBe(oversized);
  });

  test("preserves a replacement whose PID changes before stale removal", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arketa-lock-"));
    const path = join(directory, "run.lock");
    const replacement = lockContents(88);
    await writeFile(path, lockContents(), "utf8");
    let reads = 0;

    await expect(
      acquireProfileLock(
        path,
        ensureDirectory,
        operations({
          readFile: async (readPath) => {
            reads += 1;
            if (reads === 2) await writeFile(path, replacement, "utf8");
            return readFile(readPath, "utf8");
          }
        }),
        environment()
      )
    ).rejects.toBeInstanceOf(LockUnavailableError);
    expect(await readFile(path, "utf8")).toBe(replacement);
  });

  test("preserves a replacement whose inode changes before stale removal", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arketa-lock-"));
    const path = join(directory, "run.lock");
    const replacementPath = join(directory, "replacement.lock");
    const replacement = lockContents();
    await writeFile(path, lockContents(), "utf8");
    await writeFile(replacementPath, replacement, "utf8");
    let stats = 0;

    await expect(
      acquireProfileLock(
        path,
        ensureDirectory,
        operations({
          stat: async (statPath) => {
            stats += 1;
            if (stats === 2) {
              await unlink(path);
              await rename(replacementPath, path);
            }
            return stat(statPath);
          }
        }),
        environment()
      )
    ).rejects.toBeInstanceOf(LockUnavailableError);
    expect(await readFile(path, "utf8")).toBe(replacement);
  });

  test("preserves a winner when the single recovery retry loses", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arketa-lock-"));
    const path = join(directory, "run.lock");
    const winning = lockContents(88);
    await writeFile(path, lockContents(), "utf8");

    await expect(
      acquireProfileLock(
        path,
        ensureDirectory,
        operations({
          unlink: async (removedPath) => {
            await unlink(removedPath);
            await writeFile(path, winning, "utf8");
          }
        }),
        environment()
      )
    ).rejects.toBeInstanceOf(LockUnavailableError);
    expect(await readFile(path, "utf8")).toBe(winning);
  });

  test("lets a fresh winner finish when a contender observes its partial lock", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arketa-lock-"));
    const path = join(directory, "run.lock");
    let continueWinner!: () => void;
    const winnerGate = new Promise<void>((resolve) => {
      continueWinner = resolve;
    });
    let winnerOpened!: () => void;
    const opened = new Promise<void>((resolve) => {
      winnerOpened = resolve;
    });
    const winner = acquireProfileLock(
      path,
      ensureDirectory,
      operations({
        statFile: async (handle) => {
          winnerOpened();
          await winnerGate;
          return handle.stat();
        }
      }),
      environment()
    );
    await opened;

    await expect(
      acquireProfileLock(
        path,
        ensureDirectory,
        operations(),
        environment({ pid: 43 })
      )
    ).rejects.toBeInstanceOf(LockUnavailableError);
    continueWinner();
    const winnerLock = await winner;
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      version: 2,
      pid: 42
    });
    await winnerLock.release();
  });

  test("removes its lock when acquisition initialization fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arketa-lock-"));
    const path = join(directory, "run.lock");

    await expect(
      acquireProfileLock(
        path,
        ensureDirectory,
        operations({
          writeFile: async () => {
            throw filesystemError("EIO");
          }
        }),
        environment()
      )
    ).rejects.toThrow();
    await expect(readFile(path, "utf8")).rejects.toThrow();
  });

  test("preserves a replacement during acquisition cleanup", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arketa-lock-"));
    const path = join(directory, "run.lock");
    const replacementPath = join(directory, "replacement.lock");
    const replacement = lockContents(88);

    await expect(
      acquireProfileLock(
        path,
        ensureDirectory,
        operations({
          writeFile: async () => {
            throw filesystemError("EIO");
          },
          close: async (handle) => {
            await writeFile(replacementPath, replacement, "utf8");
            await handle.close();
            await unlink(path);
            await rename(replacementPath, path);
          }
        }),
        environment()
      )
    ).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe(replacement);
  });

  test("serializes concurrent release calls", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arketa-lock-"));
    const path = join(directory, "run.lock");
    let unlinkCalls = 0;
    const lock = await acquireProfileLock(
      path,
      ensureDirectory,
      operations({
        unlink: async (removedPath) => {
          unlinkCalls += 1;
          await unlink(removedPath);
        }
      }),
      environment()
    );

    await expect(
      Promise.all([lock.release(), lock.release()])
    ).resolves.toEqual([{ released: true }, { released: true }]);
    expect(unlinkCalls).toBe(1);
  });

  test.each(["close", "stat", "unlink"] as const)(
    "returns the typed %s stage for release failure",
    async (stage) => {
      const directory = await mkdtemp(join(tmpdir(), "arketa-lock-"));
      const path = join(directory, "run.lock");
      let releasing = false;
      const lock = await acquireProfileLock(
        path,
        ensureDirectory,
        operations({
          close: async (handle) => {
            await handle.close();
            if (stage === "close") throw filesystemError("EIO");
          },
          stat: async (statPath) => {
            if (releasing && stage === "stat") throw filesystemError("EIO");
            return stat(statPath);
          },
          unlink: async (removedPath) => {
            if (stage === "unlink") throw filesystemError("EIO");
            await unlink(removedPath);
          }
        }),
        environment()
      );
      releasing = true;

      await expect(lock.release()).resolves.toEqual({ released: false, stage });
    }
  );

  test("release preserves a replacement file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arketa-lock-"));
    const path = join(directory, "run.lock");
    const replacementPath = join(directory, "replacement.lock");
    const replacement = lockContents(88);
    let releasing = false;
    const lock = await acquireProfileLock(
      path,
      ensureDirectory,
      operations({
        close: async (handle) => {
          await handle.close();
          if (releasing) {
            await writeFile(replacementPath, replacement, "utf8");
            await unlink(path);
            await rename(replacementPath, path);
          }
        }
      }),
      environment()
    );
    releasing = true;

    await expect(lock.release()).resolves.toEqual({ released: true });
    expect(await readFile(path, "utf8")).toBe(replacement);
  });

  test("supports a valid runtime path with spaces and Unicode", async () => {
    const parent = await mkdtemp(join(tmpdir(), "arketa-lock-parent-"));
    const path = join(parent, "private runtime ü", "run.lock");

    const lock = await acquireProfileLock(
      path,
      ensureDirectory,
      operations(),
      environment()
    );

    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      version: 2,
      pid: 42
    });
    await lock.release();
  });
});

describe("default PID probe", () => {
  test.each([
    [undefined, false],
    ["EPERM", false],
    ["ESRCH", true],
    ["EIO", false]
  ] as const)(
    "handles process.kill result %s conservatively",
    async (code, recovers) => {
      vi.spyOn(process, "kill").mockImplementation(() => {
        if (code === undefined) return true;
        throw filesystemError(code);
      });
      const directory = await mkdtemp(join(tmpdir(), "arketa-lock-"));
      const path = join(directory, "run.lock");
      await writeFile(path, lockContents(), "utf8");

      const acquisition = acquireProfileLock(path);
      if (recovers) {
        const lock = await acquisition;
        await lock.release();
      } else {
        await expect(acquisition).rejects.toBeInstanceOf(LockUnavailableError);
      }
    }
  );
});
