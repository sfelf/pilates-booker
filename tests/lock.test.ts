import {
  link,
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
import { describe, expect, test } from "vitest";

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
  link,
  unlink,
  ...overrides
});

const token = "00000000-0000-4000-8000-000000000001";
const otherToken = "00000000-0000-4000-8000-000000000002";

const environment = (
  overrides: Partial<LockEnvironment> = {}
): LockEnvironment => ({
  pid: 42,
  createToken: () => token,
  processIdentity: {
    identify: async (pid) =>
      pid === 42 ? { kind: "found", identity: "linux:100" } : { kind: "absent" }
  },
  ...overrides
});

const lockContents = (
  pid = 77,
  processStart = "linux:50",
  instanceToken = otherToken
): string =>
  `${JSON.stringify({
    version: 2,
    pid,
    process_start: processStart,
    instance_token: instanceToken
  })}\n`;

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
      acquireProfileLock(
        path,
        ensureDirectory,
        injectedOperations,
        environment()
      )
    ).rejects.toThrow();
    expect(events).toEqual(["close", "unlink", "unlink"]);
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
        }),
        environment()
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
        }),
        environment()
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

    const lock = await acquireProfileLock(
      path,
      async (directory) => {
        await expect(readFile(path, "utf8")).rejects.toThrow();
        await ensureDirectory(directory);
        initializedBeforeLock = true;
      },
      operations(),
      environment()
    );

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
      }),
      environment()
    );

    const first = lock.release();
    const second = lock.release();
    continueClose();

    await expect(Promise.all([first, second])).resolves.toEqual([
      { released: true },
      { released: true }
    ]);
    expect(unlinkCalls).toBe(2);
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
        injectedOperations,
        environment()
      );

      await expect(lock.release()).resolves.toEqual({
        released: false,
        stage
      });
    }
  );

  test("returns the typed stat stage for a release ownership-check failure", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arketa-lock-"));
    const path = join(directory, "run.lock");
    let releaseStarted = false;
    const injectedOperations = operations({
      stat: async (statPath) => {
        if (releaseStarted) throw filesystemError("EACCES");
        return stat(statPath);
      }
    });
    const lock = await acquireProfileLock(
      path,
      ensureDirectory,
      injectedOperations,
      environment()
    );
    releaseStarted = true;

    await expect(lock.release()).resolves.toEqual({
      released: false,
      stage: "stat"
    });
  });

  test("treats only an ENOENT stat failure as an already absent pathname", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arketa-lock-"));
    const path = join(directory, "run.lock");
    const lock = await acquireProfileLock(
      path,
      ensureDirectory,
      operations({
        link: async () => {
          throw filesystemError("ENOENT");
        }
      }),
      environment()
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
      }),
      environment()
    );

    await expect(lock.release()).resolves.toEqual({
      released: false,
      stage: "unlink"
    });
  });

  test("exclusively acquires and releases a versioned owner lock without storing paths", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arketa-lock-"));
    const path = join(directory, "run.lock");
    const lock = await acquireProfileLock(
      path,
      ensureDirectory,
      operations(),
      environment()
    );

    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      version: 2,
      pid: 42,
      process_start: "linux:100",
      instance_token: token
    });
    await expect(
      acquireProfileLock(path, ensureDirectory, operations(), environment())
    ).rejects.toBeInstanceOf(LockUnavailableError);

    await lock.release();
    const reacquired = await acquireProfileLock(
      path,
      ensureDirectory,
      operations(),
      environment()
    );
    await reacquired.release();
  });

  test("preserves a lock owned by the exact active process identity", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arketa-lock-"));
    const path = join(directory, "run.lock");
    const contents = lockContents();
    await writeFile(path, contents, "utf8");
    const activeEnvironment = environment({
      processIdentity: {
        identify: async (pid) =>
          pid === 42
            ? { kind: "found", identity: "linux:100" }
            : { kind: "found", identity: "linux:50" }
      }
    });

    await expect(
      acquireProfileLock(path, ensureDirectory, operations(), activeEnvironment)
    ).rejects.toBeInstanceOf(LockUnavailableError);
    expect(await readFile(path, "utf8")).toBe(contents);
  });

  test.each([
    ["owner PID is absent", { kind: "absent" }],
    ["PID was reused", { kind: "found", identity: "linux:51" }]
  ] as const)("recovers when the %s", async (_label, ownerResult) => {
    const directory = await mkdtemp(join(tmpdir(), "arketa-lock-"));
    const path = join(directory, "run.lock");
    await writeFile(path, lockContents(), "utf8");
    const staleEnvironment = environment({
      processIdentity: {
        identify: async (pid) =>
          pid === 42 ? { kind: "found", identity: "linux:100" } : ownerResult
      }
    });

    const lock = await acquireProfileLock(
      path,
      ensureDirectory,
      operations(),
      staleEnvironment
    );
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
      version: 2,
      pid: 42,
      process_start: "linux:100",
      instance_token: token
    });
    expect(await readdir(directory)).toEqual(["run.lock"]);
    await lock.release();
  });

  test("preserves a valid lock when owner inspection is indeterminate", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arketa-lock-"));
    const path = join(directory, "run.lock");
    const contents = lockContents();
    await writeFile(path, contents, "utf8");

    await expect(
      acquireProfileLock(
        path,
        ensureDirectory,
        operations(),
        environment({
          processIdentity: {
            identify: async (pid) =>
              pid === 42
                ? { kind: "found", identity: "linux:100" }
                : { kind: "unknown" }
          }
        })
      )
    ).rejects.toBeInstanceOf(LockUnavailableError);
    expect(await readFile(path, "utf8")).toBe(contents);
  });

  test.each([
    '{"version":1}\n',
    "",
    "{",
    lockContents(0),
    lockContents(77, "invalid identity"),
    lockContents(77, "linux:050"),
    lockContents(77, "win32:50"),
    `${encodeURIComponent(lockContents())}\n`
  ])(
    "preserves legacy or invalid lock metadata without projecting it: %j",
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

  test("preserves a winning replacement when stale recovery loses its single retry", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arketa-lock-"));
    const path = join(directory, "run.lock");
    const winning = lockContents(88, "linux:88");
    await writeFile(path, lockContents(), "utf8");
    const injectedOperations = operations({
      unlink: async (removedPath) => {
        await unlink(removedPath);
        if (removedPath === path) await writeFile(path, winning, "utf8");
      }
    });

    await expect(
      acquireProfileLock(
        path,
        ensureDirectory,
        injectedOperations,
        environment()
      )
    ).rejects.toBeInstanceOf(LockUnavailableError);
    expect(await readFile(path, "utf8")).toBe(winning);
    expect(await readdir(directory)).toEqual(["run.lock"]);
  });

  test("preserves a replacement when the lock changes after the recovery claim", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arketa-lock-"));
    const path = join(directory, "run.lock");
    const winning = lockContents(88, "linux:88");
    await writeFile(path, lockContents(), "utf8");
    const injectedOperations = operations({
      link: async (source, destination) => {
        await link(source, destination);
        await unlink(path);
        await writeFile(path, winning, "utf8");
      }
    });

    await expect(
      acquireProfileLock(
        path,
        ensureDirectory,
        injectedOperations,
        environment()
      )
    ).rejects.toBeInstanceOf(LockUnavailableError);
    expect(await readFile(path, "utf8")).toBe(winning);
    expect(await readdir(directory)).toEqual(["run.lock"]);
  });

  test("a recovery claim blocks another acquisition until stale replacement completes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arketa-lock-"));
    const path = join(directory, "run.lock");
    await writeFile(path, lockContents(), "utf8");
    let claimCreated!: () => void;
    const claimReady = new Promise<void>((resolve) => {
      claimCreated = resolve;
    });
    let continueRecovery!: () => void;
    const recoveryGate = new Promise<void>((resolve) => {
      continueRecovery = resolve;
    });
    const recoveringOperations = operations({
      link: async (source, destination) => {
        await link(source, destination);
        claimCreated();
        await recoveryGate;
      }
    });

    const recovering = acquireProfileLock(
      path,
      ensureDirectory,
      recoveringOperations,
      environment()
    );
    await claimReady;
    let recoveryStatChecks = 0;
    const losingOperations = operations({
      stat: async (statPath) => {
        if (statPath === `${path}.recovery` && recoveryStatChecks++ === 0) {
          throw filesystemError("ENOENT");
        }
        return stat(statPath);
      }
    });
    await expect(
      acquireProfileLock(path, ensureDirectory, losingOperations, environment())
    ).rejects.toBeInstanceOf(LockUnavailableError);
    expect((await readdir(directory)).sort()).toEqual([
      "run.lock",
      "run.lock.recovery"
    ]);
    continueRecovery();
    const lock = await recovering;
    expect(await readdir(directory)).toEqual(["run.lock"]);
    await lock.release();
  });

  test("fails safely when a recovered lock cannot retire its recovery claim", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arketa-lock-"));
    const path = join(directory, "run.lock");
    await writeFile(path, lockContents(), "utf8");
    const injectedOperations = operations({
      unlink: async (removedPath) => {
        if (removedPath.endsWith(".recovery")) {
          throw filesystemError("EPERM");
        }
        await unlink(removedPath);
      }
    });

    await expect(
      acquireProfileLock(
        path,
        ensureDirectory,
        injectedOperations,
        environment()
      )
    ).rejects.toThrow("runtime recovery claim cleanup failed");
    await expect(readFile(path, "utf8")).rejects.toThrow();
    expect(await readdir(directory)).toEqual(["run.lock.recovery"]);
  });

  test("release does not unlink a replacement installed after its ownership claim", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arketa-lock-"));
    const path = join(directory, "run.lock");
    const winning = lockContents(88, "linux:88");
    const releaseOperations = operations({
      link: async (source, destination) => {
        await link(source, destination);
        await unlink(path);
        await writeFile(path, winning, "utf8");
      }
    });
    const lock = await acquireProfileLock(
      path,
      ensureDirectory,
      releaseOperations,
      environment()
    );

    await lock.release();
    expect(await readFile(path, "utf8")).toBe(winning);
  });

  test("does not create a lock when the current process identity is unavailable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arketa-lock-"));
    const path = join(directory, "run.lock");

    await expect(
      acquireProfileLock(
        path,
        ensureDirectory,
        operations(),
        environment({
          processIdentity: { identify: async () => ({ kind: "unknown" }) }
        })
      )
    ).rejects.toThrow("current process identity is unavailable");
    await expect(readFile(path, "utf8")).rejects.toThrow();
  });
});
