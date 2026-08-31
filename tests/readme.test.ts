import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readRepositoryFile(path: string): Promise<string> {
  return readFile(resolve(repositoryRoot, path), "utf8");
}

function headingOffset(markdown: string, heading: string): number {
  const offset = markdown.indexOf(`## ${heading}`);
  expect(offset, `missing README heading: ${heading}`).toBeGreaterThanOrEqual(
    0
  );
  return offset;
}

function expectInOrder(markdown: string, headings: readonly string[]): void {
  const offsets = headings.map((heading) => headingOffset(markdown, heading));
  expect(offsets).toEqual([...offsets].sort((left, right) => left - right));
}

describe("README first-use contract", () => {
  it("keeps local Markdown links valid", async () => {
    const readme = await readRepositoryFile("README.md");
    const localTargets = [
      ...readme.matchAll(/\[[^\]]+\]\((?!https?:|#)([^)]+)\)/g)
    ].map(([, target]) => target);

    expect(localTargets.length).toBeGreaterThan(0);
    for (const target of localTargets) {
      await expect(
        access(resolve(repositoryRoot, target))
      ).resolves.toBeUndefined();
    }
  });

  it("orders dry-run onboarding before live authorization", async () => {
    const readme = await readRepositoryFile("README.md");
    expectInOrder(readme, [
      "Safety first",
      "Prerequisites",
      "Install",
      "Keep runtime data private",
      "Authenticate a dedicated Arketa profile",
      "Create private policy and request files",
      "Run the first dry run",
      "Understand the result",
      "Authorize one live run"
    ]);
  });

  it("provides complete POSIX and PowerShell setup paths", async () => {
    const readme = await readRepositoryFile("README.md");
    expect(readme).toContain("```sh");
    expect(readme).toContain("```powershell");
    expect(readme).toContain("npx playwright install chromium");
    expect(readme).toContain("npx playwright open --user-data-dir");
    expect(readme).toContain("$runtime = Join-Path");
    expect(readme).toContain("$profile = Join-Path $runtime");
    expect(readme).toContain("npm start -- --runtime");
  });

  it("uses only the tracked synthetic examples for configuration", async () => {
    const readme = await readRepositoryFile("README.md");
    expect(readme).toContain("config/booking-request.example.json");
    expect(readme).toContain("config/booking-policy.example.json");
    expect(readme).toContain('"dry_run": true');
    expect(readme).toContain("America/*");
    expect(readme).toContain("correct year");
  });

  it("states the supported live checkout stability and confirmation boundary", async () => {
    const readme = await readRepositoryFile("README.md");
    expect(readme).toContain(
      "Arketa must remain stable throughout the sequential authorization read and until the single submission click"
    );
    expect(readme).toContain("matching exact Arketa confirmation");
    expect(readme).toContain(
      "does not recheck form fields or the URL afterward"
    );
  });
});
