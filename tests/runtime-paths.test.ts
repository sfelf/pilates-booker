import { describe, expect, test } from "vitest";

import {
  resolveDefaultRuntime,
  resolveRuntimePaths
} from "../src/runtime-paths.js";

describe("v0.2.0 runtime paths", () => {
  test.each([
    [
      "macOS",
      { platform: "darwin", home: "/Users/synthetic" },
      "/Users/synthetic/Library/Application Support/Pilates Booker"
    ],
    [
      "Linux XDG",
      {
        platform: "linux",
        home: "/home/synthetic",
        xdgStateHome: "/private/state"
      },
      "/private/state/pilates-booker"
    ],
    [
      "Linux home fallback",
      { platform: "linux", home: "/home/synthetic" },
      "/home/synthetic/.local/state/pilates-booker"
    ],
    [
      "Linux empty XDG fallback",
      {
        platform: "linux",
        home: "/home/synthetic",
        xdgStateHome: ""
      },
      "/home/synthetic/.local/state/pilates-booker"
    ],
    [
      "Linux relative XDG fallback",
      {
        platform: "linux",
        home: "/home/synthetic",
        xdgStateHome: "relative/state"
      },
      "/home/synthetic/.local/state/pilates-booker"
    ],
    [
      "Windows",
      {
        platform: "win32",
        localAppData: "C:\\Users\\Synthetic\\AppData\\Local"
      },
      "C:\\Users\\Synthetic\\AppData\\Local\\Pilates Booker"
    ]
  ] as const)("resolves the %s default", (_name, environment, expected) => {
    expect(resolveDefaultRuntime(environment)).toBe(expected);
  });

  test.each([
    [{ platform: "darwin" }],
    [{ platform: "linux" }],
    [{ platform: "linux", home: "relative/home" }],
    [{ platform: "win32" }],
    [{ platform: "win32", localAppData: "relative\\state" }],
    [{ platform: "freebsd", home: "/home/synthetic" }]
  ] as const)("rejects an unresolved environment %#", (environment) => {
    expect(() => resolveDefaultRuntime(environment)).toThrow(
      "runtime base must be absolute"
    );
  });

  test("derives only profile, lock, and debug-log paths", () => {
    expect(resolveRuntimePaths("/private/runtime")).toEqual({
      baseDir: "/private/runtime",
      profileDir: "/private/runtime/Profile",
      lockFile: "/private/runtime/run.lock",
      logFile: "/private/runtime/pilates-booker.log",
      rotatedLogFile: "/private/runtime/pilates-booker.log.1"
    });
  });
});
