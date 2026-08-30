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

  test("keys journal and result files by a canonical request UUID", () => {
    const requestId = "00000000-0000-4000-8000-000000000701";

    expect(resolveRuntimePaths("/private/runtime-root", requestId)).toEqual({
      baseDir: "/private/runtime-root",
      profileDir: "/private/runtime-root/Profile",
      lockFile: "/private/runtime-root/run.lock",
      journalFile: `/private/runtime-root/journals/${requestId}.json`,
      resultFile: `/private/runtime-root/results/${requestId}.json`,
      logFile: "/private/runtime-root/logs/current.log"
    });
  });

  test.each([
    "00000000-0000-4000-8000-000000000701/other",
    "00000000-0000-4000-8000-000000000701.json",
    "00000000-0000-4000-8000-00000000070A"
  ])("rejects unsafe request filename input %s", (requestId) => {
    expect(() =>
      resolveRuntimePaths("/private/runtime-root", requestId)
    ).toThrow("canonical UUID");
  });
});
