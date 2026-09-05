import { readFile } from "node:fs/promises";

import { parse } from "yaml";
import { expect, test } from "vitest";

const PRIVATE_VULNERABILITY_REPORTING_URL =
  "https://github.com/sfelf/pilates-booker/security/advisories/new";
const APPROVED_SECURITY_PARAGRAPHS = [
  "# Security policy",
  `Report vulnerabilities only through [GitHub Private Vulnerability Reporting](${PRIVATE_VULNERABILITY_REPORTING_URL}).`,
  "Do not report vulnerabilities in public issues or pull requests.",
  "Do not include private evidence in public discussion.",
  "Reports are reviewed case by case. There is no response or remediation timeline guarantee."
];
const PROHIBITED_PUBLIC_REPORT_CATEGORIES = [
  "booking URLs",
  "checkout URLs",
  "class details",
  "package names or details",
  "logs containing private values",
  "request or policy contents",
  "cookies",
  "tokens",
  "authenticated captures",
  "browser profiles",
  "injury information",
  "real customer data",
  "unsafe diagnostics"
];

type IssueFormField = {
  attributes?: {
    description?: unknown;
    label?: unknown;
    placeholder?: unknown;
    value?: unknown;
  };
  id?: unknown;
  type?: unknown;
  validations?: {
    required?: unknown;
  };
};

type IssueForm = {
  body?: IssueFormField[];
  description?: unknown;
};

const governanceFiles = {
  contributing: new URL("../CONTRIBUTING.md", import.meta.url),
  security: new URL("../SECURITY.md", import.meta.url),
  bugReport: new URL(
    "../.github/ISSUE_TEMPLATE/bug_report.yml",
    import.meta.url
  ),
  featureRequest: new URL(
    "../.github/ISSUE_TEMPLATE/feature_request.yml",
    import.meta.url
  ),
  issueConfig: new URL("../.github/ISSUE_TEMPLATE/config.yml", import.meta.url),
  pullRequest: new URL("../.github/pull_request_template.md", import.meta.url)
};

function requireIssueForm(value: unknown): asserts value is IssueForm {
  expect(value).toBeTypeOf("object");
  expect(value).not.toBeNull();
  expect(Array.isArray((value as IssueForm).body)).toBe(true);
  expect(typeof (value as IssueForm).description).toBe("string");
  expect((value as IssueForm).description).not.toHaveLength(0);
  expect((value as IssueForm).description).toMatch(
    /synthetic.*privacy|privacy.*synthetic/iu
  );
}

function fieldText(field: IssueFormField): string {
  return [
    field.id,
    field.attributes?.label,
    field.attributes?.description,
    field.attributes?.placeholder,
    field.attributes?.value
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
}

function assertSafeIssueForm(form: IssueForm): void {
  const freeTextFieldIds = [
    "summary",
    "expected_behavior",
    "actual_behavior",
    "reproduction_steps",
    "environment"
  ];
  const fields = form.body ?? [];

  for (const fieldId of freeTextFieldIds) {
    expect(fields.some((field) => field.id === fieldId)).toBe(true);
  }

  const freeTextFields = fields
    .map((field, index) => ({ field, index }))
    .filter(({ field }) => /^(input|textarea)$/u.test(String(field.type)));
  expect(freeTextFields).not.toHaveLength(0);

  for (const { field, index } of freeTextFields) {
    expect(field.attributes?.description).toMatch(
      /synthetic information only/iu
    );
    expect(field.validations?.required).toBe(true);

    const precedingWarning = fields
      .slice(0, index)
      .filter((field) => field.type === "markdown")
      .map(fieldText)
      .join(" ");
    for (const category of PROHIBITED_PUBLIC_REPORT_CATEGORIES) {
      expect(precedingWarning.toLowerCase()).toContain(category.toLowerCase());
    }
  }

  for (const field of fields.filter((field) => field.type !== "markdown")) {
    for (const category of PROHIBITED_PUBLIC_REPORT_CATEGORIES) {
      expect(fieldText(field).toLowerCase()).not.toContain(
        category.toLowerCase()
      );
    }
  }
}

function normalizedParagraphs(document: string): string[] {
  return document
    .trim()
    .split(/\n\s*\n/gu)
    .map((paragraph) => paragraph.replace(/\s+/gu, " ").trim());
}

function assertPrivateSecurityPolicy(security: string): void {
  expect(normalizedParagraphs(security)).toEqual(APPROVED_SECURITY_PARAGRAPHS);

  const urls = [...security.matchAll(/https:\/\/[^\s)]+/gu)].map(
    ([url]) => url
  );
  expect(urls).toEqual([PRIVATE_VULNERABILITY_REPORTING_URL]);
}

test("publishes bounded contribution and private vulnerability-reporting routes", async () => {
  const [contributing, security] = await Promise.all([
    readFile(governanceFiles.contributing, "utf8"),
    readFile(governanceFiles.security, "utf8")
  ]);

  expect(contributing).toMatch(/considered case by case/iu);
  expect(contributing).toMatch(
    /no response, support, or acceptance guarantee/iu
  );
  expect(contributing).toMatch(/respectful, privacy-conscious participation/iu);
  expect(contributing).not.toMatch(/code of conduct/iu);

  assertPrivateSecurityPolicy(security);
});

test("accepts only the canonical security-policy content", () => {
  expect(() =>
    assertPrivateSecurityPolicy(APPROVED_SECURITY_PARAGRAPHS.join("\n\n"))
  ).not.toThrow();
});

test.each([
  [
    "the reviewer public-issue route",
    (security: string) =>
      security.replace(
        "Do not report vulnerabilities in public issues or pull requests.",
        "Report vulnerabilities in public issues."
      )
  ],
  [
    "the reviewer email route",
    (security: string) =>
      `${security}\n\nUse security@example.invalid for vulnerability reports.`
  ],
  [
    "the reviewer alternate HTTPS route",
    (security: string) =>
      `${security}\n\nUse https://example.invalid/report for vulnerability reports.`
  ],
  [
    "the reviewer timeline promise",
    (security: string) => `${security}\n\nWe will respond within one day.`
  ],
  [
    "an arbitrary appended relative route",
    (security: string) => `${security}\n\nUse /security for a report.`
  ],
  [
    "an arbitrary appended timeline sentence",
    (security: string) =>
      `${security}\n\nA report receives an answer next year.`
  ]
])("rejects %s", (_description, mutate) => {
  expect(() =>
    assertPrivateSecurityPolicy(
      mutate(APPROVED_SECURITY_PARAGRAPHS.join("\n\n"))
    )
  ).toThrow();
});

test("routes public issue forms through fixed privacy warnings", async () => {
  const [bugReport, featureRequest] = await Promise.all([
    readFile(governanceFiles.bugReport, "utf8"),
    readFile(governanceFiles.featureRequest, "utf8")
  ]);

  for (const source of [bugReport, featureRequest]) {
    const form = parse(source) as unknown;
    requireIssueForm(form);
    assertSafeIssueForm(form);
    const environment = (form.body ?? []).find(
      (field) => field.id === "environment"
    );
    expect(environment?.attributes?.placeholder).toContain(
      "Pilates Booker v0.2.2"
    );
  }
});

test("rejects an added free-text issue field without the required privacy boundary", () => {
  const unsafeForm: IssueForm = {
    description: "Submit synthetic, privacy-conscious reports only.",
    body: [
      {
        type: "markdown",
        attributes: {
          value: `Do not include ${PROHIBITED_PUBLIC_REPORT_CATEGORIES.join(", ")}.`
        }
      },
      {
        type: "textarea",
        id: "summary",
        attributes: { description: "Use synthetic information only." },
        validations: { required: true }
      },
      {
        type: "textarea",
        id: "expected_behavior",
        attributes: { description: "Use synthetic information only." },
        validations: { required: true }
      },
      {
        type: "textarea",
        id: "actual_behavior",
        attributes: { description: "Use synthetic information only." },
        validations: { required: true }
      },
      {
        type: "textarea",
        id: "reproduction_steps",
        attributes: { description: "Use synthetic information only." },
        validations: { required: true }
      },
      {
        type: "input",
        id: "environment",
        attributes: { description: "Use synthetic information only." },
        validations: { required: true }
      },
      {
        type: "textarea",
        id: "extra_details",
        attributes: {
          description:
            "Describe Class Details using synthetic information only."
        },
        validations: { required: true }
      }
    ]
  };

  expect(() => assertSafeIssueForm(unsafeForm)).toThrow();
});

test("disables blank issues and routes private vulnerability reports", async () => {
  const config = parse(await readFile(governanceFiles.issueConfig, "utf8")) as {
    blank_issues_enabled?: unknown;
    contact_links?: { name?: unknown; url?: unknown }[];
  };

  expect(config.blank_issues_enabled).toBe(false);
  expect(config.contact_links).toContainEqual({
    name: "Private Vulnerability Reporting",
    url: PRIVATE_VULNERABILITY_REPORTING_URL,
    about: expect.any(String)
  });
});

test("requires pull requests to preserve the public privacy boundary", async () => {
  const template = await readFile(governanceFiles.pullRequest, "utf8");

  for (const category of PROHIBITED_PUBLIC_REPORT_CATEGORIES) {
    expect(template).toContain(category);
  }
  expect(template).toMatch(/scope/iu);
  expect(template).toMatch(/validation/iu);
  expect(template).toMatch(/\[ \]/u);
});
