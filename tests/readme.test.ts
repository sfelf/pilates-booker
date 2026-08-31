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

function readmeSection(markdown: string, heading: string): string {
  const start = headingOffset(markdown, heading);
  const nextHeading = markdown.indexOf("\n## ", start + 1);
  return markdown.slice(start, nextHeading === -1 ? undefined : nextHeading);
}

function fencedBlock(section: string, language: string): string {
  const match = section.match(
    new RegExp("```" + language + "\\n([\\s\\S]*?)```")
  );
  expect(match, `missing ${language} fenced block`).not.toBeNull();
  return match?.[1] ?? "";
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
      "Recover safely",
      "Authorize one live run"
    ]);
  });

  it("provides private setup, authentication, copies, and invocations for each platform", async () => {
    const readme = await readRepositoryFile("README.md");
    const install = readmeSection(readme, "Install");
    const runtime = readmeSection(readme, "Keep runtime data private");
    const authentication = readmeSection(
      readme,
      "Authenticate a dedicated Arketa profile"
    );
    const configuration = readmeSection(
      readme,
      "Create private policy and request files"
    );
    const dryRun = readmeSection(readme, "Run the first dry run");
    const liveRun = readmeSection(readme, "Authorize one live run");

    for (const platform of ["sh", "powershell"]) {
      expect(fencedBlock(install, platform)).toContain("npm ci");
      expect(fencedBlock(install, platform)).toContain(
        "npx playwright install chromium"
      );
      expect(fencedBlock(authentication, platform)).toContain(
        "npx playwright open --user-data-dir"
      );
      expect(fencedBlock(configuration, platform)).toContain(
        "config/booking-policy.example.json"
      );
      expect(fencedBlock(configuration, platform)).toContain(
        "config/booking-request.example.json"
      );
      expect(fencedBlock(dryRun, platform)).toContain("npm start -- --runtime");
      expect(fencedBlock(liveRun, platform)).toContain(
        "npm start -- --runtime"
      );
    }

    const posixSetup = fencedBlock(runtime, "sh");
    expect(posixSetup).toContain("umask 077");
    expect(posixSetup).toContain('mkdir -p -m 700 "$private_root"');
    expect(posixSetup).not.toContain('mkdir -p "$private_root" "$runtime"');
    expect(fencedBlock(configuration, "sh")).toContain(
      'chmod 600 "$policy" "$request"'
    );

    const powerShellSetup = fencedBlock(runtime, "powershell");
    expect(powerShellSetup).toContain(
      'Join-Path $env:LOCALAPPDATA "pilates-booker"'
    );
    expect(powerShellSetup).not.toContain(
      "New-Item -ItemType Directory -Force $runtime"
    );
    expect(runtime).toContain("inherited ACLs");
    expect(runtime).toContain("policy and request files");
    expect(runtime).toContain("runtime/profile");
    expect(runtime).toContain("Windows account");
  });

  it("uses only the tracked synthetic examples for configuration", async () => {
    const readme = await readRepositoryFile("README.md");
    const configuration = readmeSection(
      readme,
      "Create private policy and request files"
    );
    expect(configuration).toContain(
      "[synthetic request example](config/booking-request.example.json)"
    );
    expect(configuration).toContain(
      "[synthetic policy example](config/booking-policy.example.json)"
    );
    expect(configuration).toContain('"dry_run": true');
    expect(configuration).toContain("America/*");
    expect(configuration).toContain("correct year");
  });

  it("states the supported live checkout stability and confirmation boundary", async () => {
    const readme = await readRepositoryFile("README.md");
    const liveRun = readmeSection(readme, "Authorize one live run");
    expect(liveRun).toContain(
      "Arketa must remain stable throughout the sequential authorization read and until the single submission click"
    );
    expect(liveRun).toContain("matching exact Arketa confirmation");
    expect(liveRun).toContain(
      "does not recheck form fields or the URL afterward"
    );
  });

  it("requires two fresh UUID and live-mode edits after preserving dry-run evidence", async () => {
    const readme = await readRepositoryFile("README.md");
    const liveRun = readmeSection(readme, "Authorize one live run");

    expect(liveRun).toContain(
      "preserve the finalized dry-run UUID and evidence"
    );
    expect(liveRun).toContain("two required live-authorizing edits");
    expect(liveRun).toContain("assign a fresh request UUID");
    expect(liveRun).toContain("set `dry_run` from `true` to `false`");
    expect(liveRun).not.toContain(
      "Keep the same UUID for that authorized transaction"
    );
    expect(liveRun).not.toContain("change only `dry_run`");
  });

  it("documents the machine-readable result and recovery contract", async () => {
    const readme = await readRepositoryFile("README.md");
    const result = readmeSection(readme, "Understand the result");
    const recovery = readmeSection(readme, "Recover safely");
    for (const exitCode of ["`0`", "`20`", "`30`", "`40`"]) {
      expect(result).toContain(exitCode);
    }
    expect(result).toContain("exact stored bytes");
    expect(result).toContain("Booking command failed.");
    expect(result).toContain("packages_before");
    expect(result).toContain("package_selected");
    expect(result).toContain("google_calendar_url");
    expect(result).toContain("optional metadata");
    expect(recovery).toContain("CONFIRMATION_UNCERTAIN");
    expect(recovery).toContain("does not retry automatically");
  });

  it("documents private-data and operator recovery boundaries", async () => {
    const readme = await readRepositoryFile("README.md");
    const safety = readmeSection(readme, "Safety first");
    const recovery = readmeSection(readme, "Recover safely");
    for (const phrase of [
      "outside Git",
      "authenticated browser profile",
      "injury",
      "screenshots",
      "traces",
      "cookies"
    ]) {
      expect(safety).toContain(phrase);
    }
    expect(recovery).toContain("verify that no booking process is running");
    expect(recovery).toContain("same request UUID");
    expect(recovery).toContain("new request UUID");
  });

  it("links operator guidance to detailed architecture and safety docs", async () => {
    const readme = await readRepositoryFile("README.md");
    const validation = readmeSection(readme, "Development validation");
    const reference = readmeSection(
      readme,
      "Architecture and safety reference"
    );
    expect(reference).toContain("[Architecture](docs/architecture.md)");
    expect(reference).toContain(
      "[Safety boundaries](docs/safety-boundaries.md)"
    );
    for (const command of [
      "npm run format:check",
      "npm run lint",
      "npm run typecheck",
      "npm run build",
      "npm test",
      "git diff --check"
    ]) {
      expect(validation).toContain(command);
    }
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
