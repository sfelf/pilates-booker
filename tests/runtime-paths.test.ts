import { describe, expect, test } from "vitest";

import { resolveRuntimePaths } from "../src/runtime-paths.js";

describe("resolveRuntimePaths", () => {
  test("places every runtime artifact below the supplied private base", () => {
    expect(resolveRuntimePaths("/private/runtime-root")).toEqual({
      baseDir: "/private/runtime-root",
      profileDir: "/private/runtime-root/Profile",
      lockFile: "/private/runtime-root/run.lock",
      journalFile: "/private/runtime-root/journals/current.json",
      resultFile: "/private/runtime-root/results/current.json",
      logFile: "/private/runtime-root/logs/current.log"
    });
  });

  test("rejects a relative runtime base", () => {
    expect(() => resolveRuntimePaths("runtime")).toThrow("absolute");
  });
});
