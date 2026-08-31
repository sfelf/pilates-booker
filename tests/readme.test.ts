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
    ].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));

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

  it("documents the machine-readable result and recovery contract", async () => {
    const readme = await readRepositoryFile("README.md");
    for (const exitCode of ["`0`", "`20`", "`30`", "`40`"]) {
      expect(readme).toContain(exitCode);
    }
    expect(readme).toContain("exact stored bytes");
    expect(readme).toContain("Booking command failed.");
    expect(readme).toContain("packages_before");
    expect(readme).toContain("package_selected");
    expect(readme).toContain("google_calendar_url");
    expect(readme).toContain("optional metadata");
    expect(readme).toContain("CONFIRMATION_UNCERTAIN");
    expect(readme).toContain("does not retry automatically");
  });

  it("documents private-data and operator recovery boundaries", async () => {
    const readme = await readRepositoryFile("README.md");
    for (const phrase of [
      "outside Git",
      "authenticated browser profile",
      "injury",
      "screenshots",
      "traces",
      "cookies",
      "verify that no booking process is running",
      "same request UUID",
      "new request UUID"
    ]) {
      expect(readme).toContain(phrase);
    }
  });

  it("links operator guidance to detailed architecture and safety docs", async () => {
    const readme = await readRepositoryFile("README.md");
    expect(readme).toContain("[Architecture](docs/architecture.md)");
    expect(readme).toContain("[Safety boundaries](docs/safety-boundaries.md)");
    expect(readme).toContain("npm run format:check");
    expect(readme).toContain("npm run lint");
    expect(readme).toContain("npm run typecheck");
    expect(readme).toContain("npm run build");
    expect(readme).toContain("npm test");
    expect(readme).toContain("git diff --check");
  });

  it("does not contain known private planning or live-page values", async () => {
    const readme = await readRepositoryFile("README.md");
    for (const forbidden of [
      "tnelson@sfelf.com",
      "c0JdazGBINRcEMeP3pAu",
      "bT1FeE37MjReCgAHFYxb",
      "Move With Studio",
      ".superpowers/",
      "docs/superpowers/"
    ]) {
      expect(readme).not.toContain(forbidden);
    }
  });
});
