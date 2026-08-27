import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { advanceJournal, readJournal } from "../src/journal.js";
import type { JournalRecord, JournalState } from "../src/contracts.js";

const requestId = "00000000-0000-4000-8000-000000000003";
const record = (state: JournalState): JournalRecord => ({
  schema_version: 1,
  request_id: requestId,
  state
});

describe("advanceJournal", () => {
  test("accepts every transition in the monotonic state sequence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arketa-journal-"));
    const path = join(directory, "journal.json");

    for (const state of [
      "INITIALIZED",
      "VALIDATED",
      "READY_TO_SUBMIT",
      "SUBMITTING",
      "CONFIRMED"
    ] as const) {
      await advanceJournal(path, record(state));
      expect(await readJournal(path)).toEqual(record(state));
    }
  });

  test.each([
    ["INITIALIZED", "READY_TO_SUBMIT"],
    ["VALIDATED", "INITIALIZED"],
    ["SUBMITTING", "SUBMITTING"],
    ["CONFIRMED", "SUBMITTING"]
  ] as const)("rejects %s to %s", async (from, to) => {
    const directory = await mkdtemp(join(tmpdir(), "arketa-journal-"));
    const path = join(directory, "journal.json");
    await writeFile(path, JSON.stringify(record(from)), "utf8");

    await expect(advanceJournal(path, record(to))).rejects.toThrow(
      "invalid journal transition"
    );
    expect(await readJournal(path)).toEqual(record(from));
  });

  test("rejects request identifier changes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arketa-journal-"));
    const path = join(directory, "journal.json");
    await advanceJournal(path, record("INITIALIZED"));

    await expect(
      advanceJournal(path, {
        ...record("VALIDATED"),
        request_id: "00000000-0000-4000-8000-000000000004"
      })
    ).rejects.toThrow("request identifier");
  });

  test.each(["", "{", "null", '{"schema_version":1}'])(
    "rejects partial or malformed existing journal %j",
    async (content) => {
      const directory = await mkdtemp(join(tmpdir(), "arketa-journal-"));
      const path = join(directory, "journal.json");
      await writeFile(path, content, "utf8");
      await expect(advanceJournal(path, record("VALIDATED"))).rejects.toThrow(
        "journal"
      );
    }
  );
});
