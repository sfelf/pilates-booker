import { describe, expect, test, vi } from "vitest";

import { createProcessIdentityProvider } from "../src/process-identity.js";

const linuxStat = (pid: number, start: string): string =>
  `${pid} (node worker) S ${Array.from({ length: 19 }, (_, index) =>
    index === 18 ? start : String(index + 1)
  ).join(" ")}`;

describe("process identity provider", () => {
  test("reads the Linux process start tick without being confused by spaces in comm", async () => {
    const readFile = vi.fn(async () => linuxStat(42, "987654"));
    const provider = createProcessIdentityProvider("linux", { readFile });

    await expect(provider.identify(42)).resolves.toEqual({
      kind: "found",
      identity: "linux:987654"
    });
    expect(readFile).toHaveBeenCalledWith("/proc/42/stat", "utf8");
  });

  test.each([
    ["ENOENT", { kind: "absent" }],
    ["EACCES", { kind: "unknown" }]
  ] as const)(
    "classifies Linux %s without exposing the error",
    async (code, expected) => {
      const provider = createProcessIdentityProvider("linux", {
        readFile: async () => {
          throw Object.assign(new Error("private operating-system detail"), {
            code
          });
        }
      });

      await expect(provider.identify(42)).resolves.toEqual(expected);
    }
  );

  test.each([
    [
      "darwin",
      "Wed Sep  2 12:34:56 2026",
      `darwin:${Date.UTC(2026, 8, 2, 12, 34, 56) / 1000}`
    ],
    ["win32", "638923844960000000", "win32:638923844960000000"]
  ] as const)(
    "normalizes %s process-start output",
    async (platform, stdout, identity) => {
      const run = vi.fn(async () => ({ kind: "ok" as const, stdout }));
      const provider = createProcessIdentityProvider(platform, { run });

      await expect(provider.identify(42)).resolves.toEqual({
        kind: "found",
        identity
      });
      expect(run).toHaveBeenCalledOnce();
    }
  );

  test.each(["darwin", "win32"] as const)(
    "preserves absent and unknown %s command outcomes",
    async (platform) => {
      for (const kind of ["absent", "unknown"] as const) {
        const provider = createProcessIdentityProvider(platform, {
          run: async () => ({ kind }),
          probe: async () => ({ kind: "unknown" })
        });
        await expect(provider.identify(42)).resolves.toEqual({ kind });
      }
    }
  );

  test("classifies macOS absence only when the PID probe also proves absence", async () => {
    const provider = createProcessIdentityProvider("darwin", {
      run: async () => ({ kind: "unknown" }),
      probe: async () => ({ kind: "absent" })
    });

    await expect(provider.identify(42)).resolves.toEqual({ kind: "absent" });
  });

  test.each(["darwin", "win32"] as const)(
    "fails closed when the %s process query throws",
    async (platform) => {
      const provider = createProcessIdentityProvider(platform, {
        run: async () => {
          throw new Error("private process-query failure");
        }
      });

      await expect(provider.identify(42)).resolves.toEqual({ kind: "unknown" });
    }
  );

  test("fails closed on unsupported platforms", async () => {
    const provider = createProcessIdentityProvider("aix", {});

    await expect(provider.identify(42)).resolves.toEqual({ kind: "unknown" });
  });
});
