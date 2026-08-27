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

  test("isolates journal and result artifacts by canonical request ID", () => {
    const requestId = "00000000-0000-4000-8000-000000000003";
    const paths = resolveRuntimePaths("/private/runtime-root", requestId);

    expect(paths.journalFile).toBe(
      `/private/runtime-root/journals/${requestId}.json`
    );
    expect(paths.resultFile).toBe(
      `/private/runtime-root/results/${requestId}.json`
    );
    expect(() =>
      resolveRuntimePaths("/private/runtime-root", "../private")
    ).toThrow("canonical UUID");
  });
});
