import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import journalSchema from "../schemas/journal.schema.json" with { type: "json" };
import type { JournalRecord, JournalState } from "./contracts.js";
import { writeJsonAtomic } from "./atomic-json.js";

const require = createRequire(import.meta.url);
const Ajv = require("ajv").default;
const addFormats = require("ajv-formats").default;
const ajv = addFormats(new Ajv({ allErrors: true, strict: true }));
const journalValidator = ajv.compile(journalSchema);
const validateJournal = (value: unknown): value is JournalRecord =>
  journalValidator(value) as boolean;
const states: readonly JournalState[] = [
  "INITIALIZED",
  "VALIDATED",
  "READY_TO_SUBMIT",
  "SUBMITTING",
  "CONFIRMED"
];

export async function readJournal(
  path: string
): Promise<JournalRecord | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("existing journal is malformed");
  }
  if (!validateJournal(value)) {
    throw new Error("existing journal is invalid");
  }
  return value;
}

export async function advanceJournal(
  path: string,
  next: JournalRecord
): Promise<void> {
  if (!validateJournal(next)) throw new Error("next journal record is invalid");
  const current = await readJournal(path);
  if (current === undefined) {
    if (next.state !== "INITIALIZED") {
      throw new Error("invalid journal transition");
    }
  } else {
    if (current.request_id !== next.request_id) {
      throw new Error("journal request identifier cannot change");
    }
    const expected = states[states.indexOf(current.state) + 1];
    if (next.state !== expected) throw new Error("invalid journal transition");
  }
  await writeJsonAtomic(path, next, validateJournal);
}
