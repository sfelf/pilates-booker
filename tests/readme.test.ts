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

function troubleshootingEntry(section: string, label: string): string {
  const entry = section
    .split("\n")
    .find((line) => line.startsWith(`- **${label}:**`));
  expect(entry, `missing troubleshooting entry: ${label}`).toBeDefined();
  return entry ?? "";
}

describe("README first-use contract", () => {
  it("starts with an operator mental model and dry-run warning", async () => {
    const readme = await readRepositoryFile("README.md");
    const opening = readme.slice(0, headingOffset(readme, "Safety first"));

    expect(opening).toContain(
      "command-line tool for previewing or submitting one Arketa booking or waitlist request"
    );
    expect(opening).toContain(
      "checks the supplied checkout, request, and policy"
    );
    expect(opening).toContain("Start with a dry run");
    expect(opening).toContain(
      "live run can make one external booking or waitlist attempt"
    );
  });

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
      "Install Pilates Booker",
      "Keep private files private",
      "Sign in to Arketa",
      "Create private request and policy files",
      "Run a dry run",
      "Read the result",
      "Recover safely",
      "Make one live attempt"
    ]);
  });

  it("provides private setup, authentication, copies, and invocations for each platform", async () => {
    const readme = await readRepositoryFile("README.md");
    const install = readmeSection(readme, "Install Pilates Booker");
    const runtime = readmeSection(readme, "Keep private files private");
    const authentication = readmeSection(readme, "Sign in to Arketa");
    const configuration = readmeSection(
      readme,
      "Create private request and policy files"
    );
    const dryRun = readmeSection(readme, "Run a dry run");
    const liveRun = readmeSection(readme, "Make one live attempt");

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
    expect(posixSetup).toContain('mkdir -p -m 700 "$private_root" "$runtime"');
    expect(posixSetup).toContain('chmod 700 "$private_root" "$runtime"');
    expect(runtime).not.toContain("app owns its secure creation");
    expect(fencedBlock(configuration, "sh")).toContain(
      'chmod 600 "$policy" "$request"'
    );

    const powerShellSetup = fencedBlock(runtime, "powershell");
    expect(powerShellSetup).toContain(
      'Join-Path $env:LOCALAPPDATA "pilates-booker"'
    );
    expect(powerShellSetup).toContain(
      "New-Item -ItemType Directory -Force $runtime"
    );
    expect(runtime).toContain("inherited ACLs");
    expect(runtime).toContain("runtime");
    expect(runtime).toContain("policy and request files");
    expect(runtime).toContain("generated profile");
    expect(runtime).toContain("Windows account");
  });

  it("uses only the tracked synthetic examples for configuration", async () => {
    const readme = await readRepositoryFile("README.md");
    const configuration = readmeSection(
      readme,
      "Create private request and policy files"
    );
    expect(configuration).toContain(
      "[synthetic request example](config/booking-request.example.json)"
    );
    expect(configuration).toContain(
      "[synthetic policy example](config/booking-policy.example.json)"
    );
    expect(configuration).toContain('"dry_run": true');
    expect(configuration).toContain("fresh lowercase canonical request UUID");
    expect(configuration).toContain("America/*");
    expect(configuration).toContain("correct year");
  });

  it("states the supported live checkout stability and confirmation boundary", async () => {
    const readme = await readRepositoryFile("README.md");
    const liveRun = readmeSection(readme, "Make one live attempt");
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
    const liveRun = readmeSection(readme, "Make one live attempt");

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
    const result = readmeSection(readme, "Read the result");
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

  it("distinguishes finalized technical failures and null package selection", async () => {
    const readme = await readRepositoryFile("README.md");
    const result = readmeSection(readme, "Read the result");

    expect(result).toContain("finalized `TECHNICAL_FAILURE`");
    expect(result).toContain("JSON on stdout");
    expect(result).toContain("only when no finalized result can be emitted");
    expect(result).toContain("package_selected can be `null`");
    expect(result).toContain("coherent safe-stop result");
    expect(result).toContain("trustworthy positive-balance inventory");
    expect(result).toContain("policy allowlist");
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

  it("centralizes deliberate reruns around finalized results", async () => {
    const readme = await readRepositoryFile("README.md");
    const recovery = readmeSection(readme, "Recover safely");

    expect(recovery).toContain("If a finalized result exists");
    expect(recovery).toContain("preserve and inspect it");
    expect(recovery).toContain("correct the cause");
    expect(recovery).toContain("fresh lowercase canonical request UUID");
    expect(recovery).toContain("deliberately rerun");
    expect(recovery).toContain("If no finalized result exists");
    expect(recovery).toContain(
      "retain or reuse the request UUID only when appropriate"
    );
    expect(recovery).toContain("correcting the command failure");
    expect(recovery).not.toContain("rerun the same request UUID");
  });

  it("applies the centralized rerun rule to troubleshooting", async () => {
    const readme = await readRepositoryFile("README.md");
    const troubleshooting = readmeSection(readme, "Troubleshooting");
    const expiredAuthentication = troubleshootingEntry(
      troubleshooting,
      "Expired authentication"
    );
    const safeStop = troubleshootingEntry(troubleshooting, "Safe stop (`20`)");
    const technicalFailure = troubleshootingEntry(
      troubleshooting,
      "Technical failure (`30`)"
    );

    expect(expiredAuthentication).toContain(
      "finalized `SAFE_STOP` or `TECHNICAL_FAILURE`"
    );
    expect(expiredAuthentication).toContain("preserve the finalized evidence");
    expect(expiredAuthentication).toContain(
      "fresh lowercase canonical request UUID"
    );
    expect(expiredAuthentication).toContain("only if no result was finalized");
    for (const entry of [safeStop, technicalFailure]) {
      expect(entry).toContain("rerun rule in `Recover safely`");
    }
  });

  it("keeps the exit-20 table action aligned with safe-stop recovery", async () => {
    const readme = await readRepositoryFile("README.md");
    const result = readmeSection(readme, "Read the result");
    const exitTwenty = result
      .split("\n")
      .find((line) => line.startsWith("| `20`"));

    expect(exitTwenty, "missing exit-20 result row").toBeDefined();
    expect(exitTwenty).toContain("Preserve and inspect the finalized result");
    expect(exitTwenty).toContain("assign a fresh request UUID");
    expect(exitTwenty).toContain("deliberate rerun");
  });

  it("documents technical-failure retries and manual stale-lock removal", async () => {
    const readme = await readRepositoryFile("README.md");
    const recovery = readmeSection(readme, "Recover safely");
    const technicalFailure = troubleshootingEntry(
      readmeSection(readme, "Troubleshooting"),
      "Technical failure (`30`)"
    );

    expect(recovery).toContain("finalized `TECHNICAL_FAILURE`");
    expect(recovery).toContain("<runtime>/run.lock");
    expect(recovery).toContain("verify that no booking process is running");
    expect(fencedBlock(recovery, "sh")).toContain('rm "$runtime/run.lock"');
    expect(fencedBlock(recovery, "powershell")).toContain(
      'Remove-Item -LiteralPath (Join-Path $runtime "run.lock")'
    );
    expect(technicalFailure).toContain("rerun rule in `Recover safely`");
    expect(technicalFailure).toContain("no finalized result");
    expect(technicalFailure).toContain("Booking command failed.");
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
