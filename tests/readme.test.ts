import { readFile } from "node:fs/promises";

import { expect, test } from "vitest";

test("documents only the executable CLI-only v0.2.0 operating model", async () => {
  const readme = await readFile(
    new URL("../README.md", import.meta.url),
    "utf8"
  );
  for (const required of [
    "--booking-url",
    "--allow-package",
    "--book-only",
    "--dry-run",
    "--debug",
    "pilates-booker.log.1",
    "outside the repository checkout",
    "Omitting `--dry-run` permits one live",
    "verify that `observed_class` matches the class you intend to book",
    "debug logger initialization failure produces a schema-version-2 `TECHNICAL_FAILURE`",
    "Arketa is authoritative",
    "recorded PID is conclusively absent",
    "legacy, malformed, unreadable, active, or indeterminate",
    "PID reuse",
    "unreaped zombie",
    "device/inode",
    "not atomic",
    "power-loss"
  ]) {
    expect(readme).toContain(required);
  }
  expect(readme).not.toMatch(
    /request_id|--policy|booking-request\.json|booking-policy\.json|journal|result file/iu
  );
});
