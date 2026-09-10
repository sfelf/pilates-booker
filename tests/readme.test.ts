import { readFile } from "node:fs/promises";

import { expect, test } from "vitest";

import { APPLICATION_VERSION } from "../src/version.js";

test("documents only the executable CLI-only operating model", async () => {
  const [
    readme,
    architecture,
    safetyBoundaries,
    packageJson,
    packageLock,
    versionSource
  ] = await Promise.all([
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/architecture.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/safety-boundaries.md", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
    readFile(new URL("../src/version.ts", import.meta.url), "utf8")
  ]);
  expect(JSON.parse(packageJson)).toMatchObject({
    description:
      "A command-line assistant to book or waitlist a Pilates class.",
    repository: {
      type: "git",
      url: "git+https://github.com/sfelf/pilates-booker.git"
    },
    license: "AGPL-3.0-or-later",
    private: true,
    version: APPLICATION_VERSION,
    engines: { node: "^22.13.0 || ^24.0.0 || >=26.0.0" }
  });
  expect(JSON.parse(packageLock)).toMatchObject({
    version: APPLICATION_VERSION,
    packages: {
      "": {
        license: "AGPL-3.0-or-later",
        version: APPLICATION_VERSION
      }
    }
  });
  expect(APPLICATION_VERSION).toMatch(
    /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u
  );
  expect(versionSource).not.toMatch(
    /APPLICATION_VERSION\s*=\s*["']\d+\.\d+\.\d+/u
  );
  expect(architecture).toContain(
    "Pilates Booker is one independent command invocation."
  );
  expect(architecture).not.toMatch(
    /Pilates Booker v\d+\.\d+\.\d+ is one independent command invocation\./u
  );
  for (const required of [
    "page.evaluate()",
    "page.waitForFunction()",
    "Chromium",
    "Vitest's instrumented Node workers",
    "booking-page Playwright suite",
    "live Codecov report",
    "does not merge Chromium coverage",
    "does not enforce a coverage threshold"
  ]) {
    expect(architecture).toContain(required);
  }
  expect(architecture).toContain("../tests/booking-page.test.ts");
  expect(architecture).toContain(
    "https://app.codecov.io/gh/sfelf/pilates-booker"
  );
  expect(architecture).not.toMatch(
    /\d+(?:\.\d+)?% (?:line|branch|function) coverage|\d+ (?:automated|Playwright) tests|v\d+\.\d+\.\d+ release baseline/u
  );
  for (const required of [
    "direct checkout and calendar discovery modes",
    "calendar-page.ts",
    "one persistent Chromium context and page",
    "resolved checkout URL",
    "before any checkout mutation",
    "exactly one",
    "12 weeks",
    "TECHNICAL_FAILURE",
    "SAFE_STOP",
    "CONFIRMATION_UNCERTAIN"
  ]) {
    expect(architecture).toContain(required);
  }
  for (const required of [
    "Calendar URL and requested class identity",
    "Displayed calendar week and listings",
    "Discovered checkout URL",
    "exactly one visible class",
    "same studio",
    "before any checkout mutation",
    "12-week",
    "does not provide scheduling",
    "automatic login",
    "booking retry",
    "private Arketa API access",
    "fuzzy class matching"
  ]) {
    expect(safetyBoundaries).toContain(required);
  }
  for (const required of [
    "node dist/main.js --version",
    "pilates-booker <semver>",
    "if they differ, run `npm run build`",
    "--booking-url",
    "--calendar-url",
    "--class-name",
    "--class-date",
    "--class-time",
    "--allow-package",
    "--book-only",
    "--dry-run",
    "--debug",
    "Node.js 22.13–22.x, 24.x, or >=26",
    "Install Node.js `^22.13.0 || ^24.0.0 || >=26.0.0`",
    "pilates-booker.log.1",
    "outside the repository checkout",
    "Windows inherited ACLs restrict the runtime to the current account",
    '--user-data-dir "/absolute/private/path/Profile"',
    "Omitting `--dry-run` permits one live",
    "verify that `observed_class` matches the class you intend to book",
    "Direct checkout mode",
    "Calendar discovery mode",
    "exactly one entry mode",
    "all four discovery arguments together",
    "studio-local",
    "exactly one visible class",
    "next 12 weeks",
    "surrounding whitespace",
    "edge decoration",
    "internal whitespace",
    "preserving case, punctuation, numbers, Unicode, and substantive text",
    "reverifies the class name, date, and start time",
    "does not use instructor, duration, fuzzy matching, scheduling, automatic login, automatic retries, or private Arketa APIs",
    "debug logger initialization failure produces a schema-version-2 `TECHNICAL_FAILURE`",
    "Arketa is authoritative",
    "Pilates Booker is an independent project and is not affiliated with or endorsed by Arketa.",
    "You are responsible for ensuring your use complies with applicable platform terms and studio policies.",
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
  for (const required of [
    "exact standalone `--version` informational path",
    "dist/version.json",
    "changing source package metadata without rebuilding cannot change",
    "before booking argument parsing",
    "Duplicate, combined, and extra-value forms remain invalid"
  ]) {
    expect(architecture).toContain(required);
  }
  expect(readme).not.toMatch(
    /request_id|--policy|booking-request\.json|booking-policy\.json|journal|result file|22\.12\.0|Node\.js >=22\.13\.0|img\.shields\.io\/badge\/release-|releases\/tag\/v\d|logo=nodedotjs|logoColor=|does not discover classes/iu
  );
  expect(readme).toMatch(/\| Symptom or exit\s+\| Meaning and action\s+\|/u);
  expect(
    readme.match(
      /\[!\[Codecov coverage\]\(https:\/\/codecov\.io\/gh\/sfelf\/pilates-booker\/branch\/main\/graph\/badge\.svg\)\]\(https:\/\/app\.codecov\.io\/gh\/sfelf\/pilates-booker\)/gu
    )
  ).toHaveLength(1);
  expect(
    readme.match(
      /\[!\[Latest release\]\(https:\/\/img\.shields\.io\/github\/v\/release\/sfelf\/pilates-booker\?display_name=tag&label=release\)\]\(https:\/\/github\.com\/sfelf\/pilates-booker\/releases\/latest\)/gu
    )
  ).toHaveLength(1);
  expect(readme.trimEnd()).toMatch(
    /## License\n\nPilates Booker is licensed under the \[GNU Affero General Public License v3\.0 or later\]\(LICENSE\) \(`AGPL-3\.0-or-later`\); see \[LICENSE\]\(LICENSE\)\.$/u
  );
});

test("uses one semantic brand heading while preserving badges", async () => {
  const readme = await readFile(
    new URL("../README.md", import.meta.url),
    "utf8"
  );
  expect(() => new ReadmeBrandImageContract(readme).assert()).not.toThrow();
  expect(() =>
    new ReadmeBrandImageContract(readme).withUnquotedAlign().assert()
  ).toThrow();
  expect(() =>
    new ReadmeBrandImageContract(readme).withThemeSourceFragment().assert()
  ).toThrow();
  expect(() =>
    new ReadmeBrandImageContract(readme).withSecondDarkLogo().assert()
  ).toThrow();
  expect(() =>
    new ReadmeBrandImageContract(readme).withSingleQuotedDarkLogo().assert()
  ).toThrow();
  expect(() =>
    new ReadmeBrandImageContract(readme).withThemeClassMarker().assert()
  ).toThrow();
  expect(() =>
    new ReadmeBrandImageContract(readme).withThemeDataModeAttribute().assert()
  ).toThrow();
  expect(() =>
    new ReadmeBrandImageContract(readme).withMarkdownLogoReference().assert()
  ).toThrow();

  expect(readme).toContain(
    "[![CI status](https://github.com/sfelf/pilates-booker/actions/workflows/ci.yml/badge.svg?branch=main)]"
  );
  expect(readme).toContain(
    "[![Codecov coverage](https://codecov.io/gh/sfelf/pilates-booker/branch/main/graph/badge.svg)]"
  );
});

class ReadmeBrandImageContract {
  private readme: string;
  private static readonly targetLogoPath = "assets/brand/logo-lockup-dark.png";
  private static readonly bannedThemeMarkers = [
    /gh-(?:dark|light)-mode-only/i,
    /<picture\b/i,
    /<source\b/i,
    /srcset\s*=\s*/i,
    /prefers-color-scheme/i,
    /data-theme/i,
    /data-color-mode/i
  ];

  constructor(readme: string) {
    this.readme = readme;
  }

  withUnquotedAlign(): this {
    this.readme = this.readme.replace("<h1>", "<h1 align=center>");
    return this;
  }

  withThemeSourceFragment(): this {
    this.readme = `${this.readme}
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/brand/logo-lockup-dark.png" />
  <source media="(prefers-color-scheme: light)" srcset="assets/brand/logo-lockup.png" />
</picture>`;
    return this;
  }

  withSecondDarkLogo(): this {
    this.readme = `${this.readme}
<img src="assets/brand/logo-lockup-dark.png" alt="Pilates Booker" width="420">`;
    return this;
  }

  withSingleQuotedDarkLogo(): this {
    this.readme = `${this.readme}
<img src='assets/brand/logo-lockup-dark.png' alt='Pilates Booker' width='420'>`;
    return this;
  }

  withThemeClassMarker(): this {
    this.readme = `${this.readme}
<div class="gh-dark-mode-only">theme marker</div>`;
    return this;
  }

  withThemeDataModeAttribute(): this {
    this.readme = `${this.readme}
<div data-color-mode="dark">theme marker</div>`;
    return this;
  }

  withMarkdownLogoReference(): this {
    this.readme = `${this.readme}
![Pilates Booker logo](${ReadmeBrandImageContract.targetLogoPath})`;
    return this;
  }

  assert(): void {
    const headingMatches = [
      ...this.readme.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/giu)
    ];
    expect(headingMatches).toHaveLength(1);
    const headingTag = headingMatches[0]?.[0] ?? "";
    const heading = headingMatches[0]?.[1] ?? "";
    const h1OpenTagAttributes =
      headingTag.match(/^<h1\b([^>]*)>/isu)?.[1] ?? "";
    expect(headingTag).toMatch(/^<h1\b[^>]*>/iu);
    expect(this.attributeValue("align", h1OpenTagAttributes)).toBeUndefined();

    const logoReferences = [
      ...this.readme.matchAll(/assets\/brand\/logo-lockup-dark\.png/giu)
    ];
    expect(logoReferences).toHaveLength(1);

    const images = [...heading.matchAll(/<img\b([^>]*)>/giu)].map((match) =>
      Object.fromEntries(
        [...this.parseTagAttributes(match[1] ?? "")].map(([name, value]) => [
          name,
          value
        ])
      )
    );
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({
      src: ReadmeBrandImageContract.targetLogoPath,
      alt: "Pilates Booker",
      width: "420"
    });
    for (const image of images) {
      expect(image).toMatchObject({
        alt: "Pilates Booker",
        width: "420"
      });
    }

    const imageMatches = [
      ...this.readme.matchAll(/<img\b[^>]*\bsrc\s*=\s*["'][^"']*["'][^>]*>/giu)
    ];
    expect(imageMatches).toHaveLength(1);

    for (const pattern of ReadmeBrandImageContract.bannedThemeMarkers) {
      expect(this.readme).not.toMatch(pattern);
    }
  }

  private parseTagAttributes(tagAttributes: string): Array<[string, string]> {
    return [
      ...tagAttributes.matchAll(
        /([a-z][a-z0-9:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s">]+))/giu
      )
    ].map(([, name, doubleValue, singleValue, unquotedValue]) => [
      name.toLowerCase(),
      doubleValue ?? singleValue ?? unquotedValue ?? ""
    ]);
  }

  private attributeValue(
    attributeName: string,
    tag: string
  ): string | undefined {
    const match = [...this.parseTagAttributes(tag)].find(
      ([name]) => name === attributeName.toLowerCase()
    );
    return match?.[1];
  }
}
