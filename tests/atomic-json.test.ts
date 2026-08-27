import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { ensureDirectoryDurable, writeJsonAtomic } from "../src/atomic-json.js";

describe("writeJsonAtomic", () => {
  test("syncs each parent after creating a nested runtime directory", async () => {
    const events: string[] = [];
    const existing = new Set(["/"]);

    await ensureDirectoryDurable("/private/runtime/journals", {
      async createDirectory(path) {
        if (existing.has(path)) return false;
        existing.add(path);
        events.push(`create:${path}`);
        return true;
      },
      async syncDirectory(path) {
        events.push(`sync:${path}`);
      }
    });

    expect(events).toEqual([
      "create:/private",
      "sync:/",
      "create:/private/runtime",
      "sync:/private",
      "create:/private/runtime/journals",
      "sync:/private/runtime"
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
});
