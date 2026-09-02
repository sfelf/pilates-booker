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
    "Omitting `--dry-run` permits one live",
    "Arketa is authoritative"
  ]) {
    expect(readme).toContain(required);
  }
  expect(readme).not.toMatch(
    /request_id|--policy|booking-request\.json|booking-policy\.json|journal|result file/iu
  );
});
