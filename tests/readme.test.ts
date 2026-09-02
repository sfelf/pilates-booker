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
    "Windows inherited ACLs restrict the runtime to the current account",
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
    "power-loss",
    "## Response object",
    '"schema_version": 2',
    '"outcome": "DRY_RUN"',
    '"packages_before"',
    '"safety_checks"',
    "## License",
    "AGPL-3.0-or-later",
    "[LICENSE](LICENSE)"
  ]) {
    expect(readme).toContain(required);
  }
  expect(readme).not.toMatch(
    /request_id|--policy|booking-request\.json|booking-policy\.json|journal|result file/iu
  );
  expect(readme).toMatch(/\| Symptom or exit\s+\| Meaning and action\s+\|/u);
  expect(readme.trimEnd()).toMatch(
    /## License\n\nPilates Booker is licensed under the \[GNU Affero General Public License v3\.0 or later\]\(LICENSE\) \(`AGPL-3\.0-or-later`\); see \[LICENSE\]\(LICENSE\)\.$/u
  );
});
