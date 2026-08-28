import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { ensureDirectory, writeJsonAtomic } from "../src/atomic-json.js";

describe("writeJsonAtomic", () => {
  test("creates each missing nested runtime directory", async () => {
    const created: string[] = [];
    const existing = new Set(["/"]);

    await ensureDirectory("/private/runtime/journals", {
      async createDirectory(path) {
        if (existing.has(path)) return false;
        existing.add(path);
        created.push(path);
        return true;
      }
    });

    expect(created).toEqual([
      "/private",
      "/private/runtime",
      "/private/runtime/journals"
    ]);
  });

  test("atomically replaces the destination and leaves no temporary file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arketa-json-"));
    const path = join(directory, "result.json");
    await writeFile(path, '{"old":true}', "utf8");

    await writeJsonAtomic(path, { outcome: "SAFE_STOP" });

    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      outcome: "SAFE_STOP"
    });
    expect(await readdir(directory)).toEqual(["result.json"]);
  });

  test("validates before replacing an authoritative destination", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arketa-json-"));
    const path = join(directory, "result.json");
    await writeFile(path, '{"old":true}', "utf8");

    await expect(
      writeJsonAtomic(path, { invalid: true }, () => false)
    ).rejects.toThrow("validation");
    expect(await readFile(path, "utf8")).toBe('{"old":true}');
  });

  test.each([
    ["undefined", undefined],
    ["function", () => undefined],
    ["symbol", Symbol("synthetic")],
    ["undefined toJSON", { toJSON: () => undefined }]
  ])(
    "rejects a non-serializable %s before replacing the destination",
    async (_label, value) => {
      const directory = await mkdtemp(join(tmpdir(), "arketa-json-"));
      const path = join(directory, "result.json");
      await writeFile(path, '{"old":true}', "utf8");

      await expect(writeJsonAtomic(path, value)).rejects.toThrow(
        "JSON serialization failed"
      );
      expect(await readFile(path, "utf8")).toBe('{"old":true}');
      expect(await readdir(directory)).toEqual(["result.json"]);
    }
  );

  test("validates the JSON representation produced by toJSON", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arketa-json-"));
    const path = join(directory, "result.json");
    await writeFile(path, '{"old":true}', "utf8");
    const prototype = { toJSON: () => ({}) };
    const value = Object.assign(Object.create(prototype) as object, {
      outcome: "SAFE_STOP"
    });
    const validate = (candidate: unknown) =>
      typeof candidate === "object" &&
      candidate !== null &&
      (candidate as Record<string, unknown>).outcome === "SAFE_STOP";

    await expect(writeJsonAtomic(path, value, validate)).rejects.toThrow(
      "validation"
    );
    expect(await readFile(path, "utf8")).toBe('{"old":true}');
    expect(await readdir(directory)).toEqual(["result.json"]);
  });
});
