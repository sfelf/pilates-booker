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

function fencedBlocks(section: string, language: string): string[] {
  return [
    ...section.matchAll(
      new RegExp("```" + language + "\\n([\\s\\S]*?)```", "g")
    )
  ].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));
}

function troubleshootingRow(section: string, symptom: string): string {
  const escapedSymptom = symptom.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const entry = section
    .split("\n")
    .find((line) => new RegExp(`^\\| ${escapedSymptom}\\s+\\|`).test(line));
  expect(entry, `missing troubleshooting row: ${symptom}`).toBeDefined();
  return entry ?? "";
}

type PrivacyFindingKind =
  | "email-shaped attendee value"
  | "live Arketa checkout URL or identifier"
  | "private planning path";

type PrivacyFinding = Readonly<{
  kind: PrivacyFindingKind;
  line: number;
}>;

function findPrivateShapedValues(markdown: string): PrivacyFinding[] {
  const findings: PrivacyFinding[] = [];
  const planningPathPattern = new RegExp(
    String.raw`\.super` + "powers/|docs/" + "super" + "powers/"
  );
  const patterns: ReadonlyArray<readonly [PrivacyFindingKind, RegExp]> = [
    [
      "email-shaped attendee value",
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
    ],
    [
      "live Arketa checkout URL or identifier",
      /https:\/\/app\.arketa\.co\/[A-Za-z0-9/?&=._~:%#-]+|(?:^|[^A-Za-z0-9_-])(?=[A-Za-z0-9_-]{20,}(?:$|[^A-Za-z0-9_-]))(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]+(?:$|[^A-Za-z0-9_-])/
    ],
    ["private planning path", planningPathPattern]
  ];

  markdown.split("\n").forEach((line, index) => {
    for (const [kind, pattern] of patterns) {
      if (pattern.test(line)) {
        findings.push({ kind, line: index + 1 });
      }
    }
  });

  return findings;
}

function privacyFindingKinds(markdown: string): Set<PrivacyFindingKind> {
  return new Set(
    findPrivateShapedValues(markdown).map((finding) => finding.kind)
  );
}

describe("README first-use contract", () => {
  it("shows accurate v0.1.0 repository badges directly below the title", async () => {
    const readme = await readRepositoryFile("README.md");
    const openingLines = readme.split("\n").slice(0, 10);
    const badgeRow = openingLines.find((line) => line.startsWith("[!["));

    expect(badgeRow, "missing badge row near README title").toBeDefined();
    expect(openingLines.indexOf(badgeRow ?? "")).toBe(2);
    expect(badgeRow).toContain(
      "[![CI status](https://github.com/sfelf/pilates-booker/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sfelf/pilates-booker/actions/workflows/ci.yml)"
    );
    expect(badgeRow).toContain(
      "[![Release: v0.1.0 planned](https://img.shields.io/badge/release-v0.1.0%20planned-lightgrey)](https://github.com/sfelf/pilates-booker/milestone/1)"
    );
    expect(badgeRow).toContain(
      "[![License: AGPL-3.0-or-later](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue)](LICENSE)"
    );
    expect(badgeRow).toContain(
      "[![Node.js >=22.12.0](https://img.shields.io/badge/Node.js-%3E%3D22.12.0-339933?logo=nodedotjs&logoColor=white)](package.json)"
    );
    expect(badgeRow).toContain(
      "[![Language: TypeScript](https://img.shields.io/static/v1?label=language&message=TypeScript&color=3178C6&logo=typescript&logoColor=white)](tsconfig.json)"
    );
    expect(badgeRow).not.toMatch(/npm|codecov/i);
  });

  it("starts with an operator mental model and dry-run warning", async () => {
    const readme = await readRepositoryFile("README.md");
    const opening = readme.slice(0, headingOffset(readme, "Before you begin"));

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
    expect(opening).toContain("without another prompt");
    expect(readme).not.toContain("## Safety first");
  });

  it("keeps local Markdown links valid", async () => {
    const readme = `${await readRepositoryFile("README.md")}\n[Architecture components](docs%2Farchitecture.md#components)\n`;
    const localTargets = [
      ...readme.matchAll(/\[[^\]]+\]\((?!https?:|#)([^)]+)\)/g)
    ].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));

    expect(localTargets.length).toBeGreaterThan(0);
    for (const target of localTargets) {
      const path = decodeURIComponent(target.split("#", 1)[0] ?? "");
      await expect(
        access(resolve(repositoryRoot, path))
      ).resolves.toBeUndefined();
    }
  });

  it("orders dry-run onboarding before live authorization", async () => {
    const readme = await readRepositoryFile("README.md");
    expectInOrder(readme, [
      "Before you begin",
      "Install Pilates Booker",
      "Create the private runtime directory",
      "Sign in to Arketa",
      "Create your private configuration",
      "Run a dry run",
      "Read the result",
      "Recover safely",
      "Make one live attempt"
    ]);
  });

  it("provides first-use setup, authentication, copies, and invocations for each platform", async () => {
    const readme = await readRepositoryFile("README.md");
    const beforeYouBegin = readmeSection(readme, "Before you begin");
    const install = readmeSection(readme, "Install Pilates Booker");
    const runtime = readmeSection(
      readme,
      "Create the private runtime directory"
    );
    const authentication = readmeSection(readme, "Sign in to Arketa");
    const configuration = readmeSection(
      readme,
      "Create your private configuration"
    );
    const dryRun = readmeSection(readme, "Run a dry run");
    const liveRun = readmeSection(readme, "Make one live attempt");

    for (const platform of ["sh", "powershell"]) {
      expect(fencedBlock(beforeYouBegin, platform)).toContain("node --version");
      expect(fencedBlock(beforeYouBegin, platform)).toContain("npm --version");
      expect(fencedBlock(beforeYouBegin, platform)).toContain("git --version");
      expect(fencedBlock(configuration, platform)).toContain("randomUUID()");
    }

    expect(beforeYouBegin).toContain("A macOS, Linux, or Windows computer.");
    expect(beforeYouBegin).toContain("Node.js `>=22.12.0`");
    expect(beforeYouBegin).toContain("outside Git");
    expect(beforeYouBegin).toContain("screenshots");
    expect(beforeYouBegin).toContain("cookies");

    const [macInstall = "", linuxInstall = ""] = fencedBlocks(install, "sh");
    expect(macInstall).toContain("$HOME/Tools/pilates-booker");
    expect(macInstall).toContain(
      "git clone https://github.com/sfelf/pilates-booker.git"
    );
    expect(macInstall).toContain("npm ci");
    expect(macInstall).toContain("npx playwright install chromium");
    expect(macInstall).toContain("npm run build");
    expect(linuxInstall).toContain("$HOME/Tools/pilates-booker");
    expect(linuxInstall).toContain("npm ci");
    expect(linuxInstall).toContain(
      "npx playwright install --with-deps chromium"
    );
    expect(linuxInstall).toContain("npm run build");
    const powerShellInstall = fencedBlock(install, "powershell");
    expect(powerShellInstall).toContain("C:\\Tools\\pilates-booker");
    expect(powerShellInstall).toContain(
      "git clone https://github.com/sfelf/pilates-booker.git"
    );
    expect(powerShellInstall).toContain("npm ci");
    expect(powerShellInstall).toContain("npx playwright install chromium");
    expect(powerShellInstall).toContain("npm run build");
    expect(install).toContain("locked dependencies");
    expect(install).toContain("dist/main.js");

    expect(runtime).toMatch(/\| Platform\s+\| Runtime directory\s+\|/);
    expect(runtime).toMatch(
      /\| macOS\s+\| `\$HOME\/Library\/Application Support\/Pilates Booker`\s+\|/
    );
    expect(runtime).toMatch(
      /\| Linux\s+\| `\$\{XDG_STATE_HOME:-\$HOME\/\.local\/state\}\/pilates-booker`\s+\|/
    );
    expect(runtime).toMatch(
      /\| Windows\s+\| `\$env:LOCALAPPDATA\\Pilates Booker`\s+\|/
    );
    expect(runtime).toContain("reuse it for every invocation");
    const posixSetup = fencedBlocks(runtime, "sh").join("\n");
    expect(posixSetup).toContain("umask 077");
    expect(posixSetup).toContain(
      'install -d -m 700 "$HOME/Library/Application Support/Pilates Booker"'
    );
    expect(runtime).toContain(
      'install -d -m 700 "${XDG_STATE_HOME:-$HOME/.local/state}/pilates-booker"'
    );
    expect(runtime).toContain("| `Profile/`");
    expect(runtime).toContain("| `run.lock`");
    expect(runtime).toContain("| `journals/<request-id>.json`");
    expect(runtime).toContain("| `results/<request-id>.json`");
    expect(runtime).toContain("replay and recovery");
    expect(runtime).not.toContain("app owns its secure creation");
    const shellConfiguration = fencedBlock(configuration, "sh");
    expect(shellConfiguration).toContain(
      'if [ ! -e "$config/booking-policy.json" ]'
    );
    expect(shellConfiguration).toContain(
      'if [ ! -e "$config/booking-request.json" ]'
    );
    expect(shellConfiguration).toContain(
      'install -m 600 config/booking-policy.example.json "$config/booking-policy.json"'
    );
    expect(shellConfiguration).toContain(
      'install -m 600 config/booking-request.example.json "$config/booking-request.json"'
    );

    const powerShellSetup = fencedBlock(runtime, "powershell");
    expect(powerShellSetup).toContain(
      '$runtime = Join-Path $env:LOCALAPPDATA "Pilates Booker"'
    );
    expect(powerShellSetup).toContain(
      "New-Item -ItemType Directory -Force $runtime"
    );
    expect(runtime).toContain("inherited ACLs");
    expect(runtime).toContain("runtime");
    expect(runtime).toContain("policy and request files");
    expect(runtime).toContain("generated profile");
    expect(runtime).toContain("Windows account");
    const powershellConfiguration = fencedBlock(configuration, "powershell");
    expect(powershellConfiguration).toContain(
      'if (-not (Test-Path -LiteralPath "$config\\booking-policy.json"))'
    );
    expect(powershellConfiguration).toContain(
      'Copy-Item config\\booking-policy.example.json "$config\\booking-policy.json"'
    );
    expect(powershellConfiguration).toContain(
      'if (-not (Test-Path -LiteralPath "$config\\booking-request.json"))'
    );
    expect(powershellConfiguration).toContain(
      'Copy-Item config\\booking-request.example.json "$config\\booking-request.json"'
    );

    expect(authentication).toContain(
      'npx playwright open --user-data-dir "$HOME/Library/Application Support/Pilates Booker/Profile"'
    );
    expect(authentication).toContain(
      'npx playwright open --user-data-dir "${XDG_STATE_HOME:-$HOME/.local/state}/pilates-booker/Profile"'
    );
    expect(authentication).toContain(
      'npx playwright open --user-data-dir "$runtime\\Profile"'
    );

    expect(dryRun).toContain('node "$HOME/Tools/pilates-booker/dist/main.js"');
    expect(dryRun).toContain("node C:\\Tools\\pilates-booker\\dist\\main.js");
    expect(dryRun).not.toContain("npm start -- --runtime");
    expect(liveRun).toContain('node "$HOME/Tools/pilates-booker/dist/main.js"');
    expect(liveRun).toContain("node C:\\Tools\\pilates-booker\\dist\\main.js");
    expect(liveRun).not.toContain("npm start -- --runtime");
  });

  it("uses only the tracked synthetic examples for configuration", async () => {
    const readme = await readRepositoryFile("README.md");
    const configuration = readmeSection(
      readme,
      "Create your private configuration"
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
    expect(result).toContain("positive-balance/approval evidence");
    expect(result).not.toContain("positive-balance/selectability evidence");
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
    expect(result).toContain("no trustworthy positive-balance package exists");
  });

  it("documents private-data and operator recovery boundaries", async () => {
    const readme = await readRepositoryFile("README.md");
    const beforeYouBegin = readmeSection(readme, "Before you begin");
    const recovery = readmeSection(readme, "Recover safely");
    for (const phrase of [
      "outside Git",
      "authenticated browser profile",
      "injury",
      "screenshots",
      "traces",
      "cookies"
    ]) {
      expect(beforeYouBegin).toContain(phrase);
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
      "inspect the available journal evidence and Arketa before deciding whether to rerun"
    );
    expect(recovery).toContain(
      "retain or reuse the request UUID only when appropriate"
    );
    expect(recovery).toContain("correcting the command failure");
    expect(recovery).not.toContain("rerun the same request UUID");
  });

  it("applies the centralized rerun rule to troubleshooting", async () => {
    const readme = await readRepositoryFile("README.md");
    const troubleshooting = readmeSection(readme, "Troubleshooting");
    expect(troubleshooting).toMatch(/\| Symptom\s+\| Action\s+\|/);
    const expiredAuthentication = troubleshootingRow(
      troubleshooting,
      "Expired authentication"
    );
    const safeStop = troubleshootingRow(troubleshooting, "Safe stop (`20`)");
    const technicalFailure = troubleshootingRow(
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
    const technicalFailure = troubleshootingRow(
      readmeSection(readme, "Troubleshooting"),
      "Technical failure (`30`)"
    );

    expect(recovery).toContain("finalized `TECHNICAL_FAILURE`");
    expect(recovery).toContain("<runtime>/run.lock");
    expect(recovery).toContain("verify that no booking process is running");
    const [macRecovery = "", linuxRecovery = ""] = fencedBlocks(recovery, "sh");
    const powershellRecovery = fencedBlock(recovery, "powershell");

    expect(macRecovery).toContain(
      'runtime="$HOME/Library/Application Support/Pilates Booker"'
    );
    expect(macRecovery).toContain('rm "$runtime/run.lock"');
    expect(linuxRecovery).toContain(
      'runtime="${XDG_STATE_HOME:-$HOME/.local/state}/pilates-booker"'
    );
    expect(linuxRecovery).toContain('rm "$runtime/run.lock"');
    expect(powershellRecovery).toContain(
      '$runtime = Join-Path $env:LOCALAPPDATA "Pilates Booker"'
    );
    expect(powershellRecovery).toContain(
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
    expect(validation).toContain(
      "CI does not execute the documented setup blocks or verify resulting filesystem permissions"
    );
    expect(validation).toContain("`git diff --check` is a local check");
    expect(validation).not.toContain("CI runs these repository checks");
    expect(validation).not.toContain(
      "CI is authoritative for executable Bash/POSIX permission behavior"
    );
  });

  it("detects synthetic private-shaped README content without storing real examples", () => {
    const syntheticEmail = "attendee" + "@" + "example.invalid";
    const syntheticCheckout =
      "https://app.arketa.co/" + "checkout/synthetic-private.invalid";
    const syntheticIdentifier = "SyntheticCheckout" + "Identifier000";
    const syntheticSeparatedIdentifier = "synthetic_id-" + "value12345";
    const syntheticPlanningPath = ".super" + "powers/private-plan.md";
    const synthetic = [
      syntheticEmail,
      syntheticCheckout,
      syntheticIdentifier,
      syntheticPlanningPath
    ].join("\n");

    expect(privacyFindingKinds(synthetic)).toEqual(
      new Set<PrivacyFindingKind>([
        "email-shaped attendee value",
        "live Arketa checkout URL or identifier",
        "private planning path"
      ])
    );
    expect(privacyFindingKinds(syntheticSeparatedIdentifier)).toEqual(
      new Set<PrivacyFindingKind>(["live Arketa checkout URL or identifier"])
    );
  });

  it("does not contain private-shaped values in README or README tests", async () => {
    const files = ["README.md", "tests/readme.test.ts"] as const;

    for (const file of files) {
      const contents = await readRepositoryFile(file);
      expect(findPrivateShapedValues(contents), file).toEqual([]);
    }
  });
});
