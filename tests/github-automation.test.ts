import { readFile, readdir } from "node:fs/promises";

import { parse } from "yaml";
import { expect, test } from "vitest";

const CHECKOUT_ACTION =
  "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1";
const SETUP_NODE_ACTION =
  "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020";
const DEPENDENCY_REVIEW_ACTION =
  "actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294";
const CODEQL_INIT_ACTION =
  "github/codeql-action/init@cdf488f595d80d6e07e03d4674febd5ab45fa938";
const CODEQL_ANALYZE_ACTION =
  "github/codeql-action/analyze@cdf488f595d80d6e07e03d4674febd5ab45fa938";
const CODECOV_ACTION =
  "codecov/codecov-action@fb8b3582c8e4def4969c97caa2f19720cb33a72f";
const READ_ONLY_PERMISSIONS = { contents: "read" };
const CODEQL_PERMISSIONS = {
  contents: "read",
  packages: "read",
  "security-events": "write"
};
const WORKFLOW_PERMISSION_PROFILES: Record<string, Record<string, string>> = {
  "ci.yml": READ_ONLY_PERMISSIONS,
  "codeql.yml": CODEQL_PERMISSIONS,
  "dependency-review.yml": READ_ONLY_PERMISSIONS
};
const ACTION_REFERENCE =
  /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*@[0-9a-f]{40}$/u;
const VERSION_COMMENT = /^#\s+v\d+(?:\.\d+)*(?:[-+][0-9A-Za-z.-]+)?$/u;

type Job = {
  if?: unknown;
  permissions?: unknown;
  steps?: { name?: unknown; run?: unknown; uses?: unknown; with?: unknown }[];
};

type Workflow = {
  concurrency?: unknown;
  jobs?: Record<string, Job>;
  on?: unknown;
  permissions?: unknown;
};

type WorkflowSource = {
  path: string;
  source: string;
};

type ActionOccurrence = {
  line: number;
  reference: string;
  versionComment: string | undefined;
};

type PermissionOccurrence = {
  path: string[];
  value: unknown;
};

type DependabotUpdate = {
  directory?: unknown;
  groups?: unknown;
  "open-pull-requests-limit"?: unknown;
  "package-ecosystem"?: unknown;
  registries?: unknown;
  schedule?: { interval?: unknown };
};

type DependabotConfig = {
  registries?: unknown;
  updates?: DependabotUpdate[];
  version?: unknown;
};

const workflowDirectory = new URL("../.github/workflows/", import.meta.url);
const ciFile = new URL("../.github/workflows/ci.yml", import.meta.url);
const dependabotFile = new URL("../.github/dependabot.yml", import.meta.url);
const dependencyReviewFile = new URL(
  "../.github/workflows/dependency-review.yml",
  import.meta.url
);
const codeqlFile = new URL("../.github/workflows/codeql.yml", import.meta.url);

function workflowFileNames(entries: readonly string[]): string[] {
  return [
    ...new Set(
      entries.filter(
        (entry) => entry.endsWith(".yml") || entry.endsWith(".yaml")
      )
    )
  ].sort();
}

async function readWorkflowSources(): Promise<WorkflowSource[]> {
  return workflowSourcesFromEntries(await readdir(workflowDirectory), (path) =>
    readFile(new URL(path, workflowDirectory), "utf8")
  );
}

async function workflowSourcesFromEntries(
  entries: readonly string[],
  readSource: (path: string) => Promise<string>
): Promise<WorkflowSource[]> {
  const files = workflowFileNames(entries);

  return Promise.all(
    files.map(async (path) => ({
      path,
      source: await readSource(path)
    }))
  );
}

function actionReferences(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(actionReferences);
  }
  if (typeof value !== "object" || value === null) {
    return [];
  }

  return Object.entries(value).flatMap(([key, nestedValue]) =>
    key === "uses" && typeof nestedValue === "string"
      ? [nestedValue]
      : actionReferences(nestedValue)
  );
}

function actionOccurrences(source: string): ActionOccurrence[] {
  return source.split("\n").flatMap((line, index) => {
    const match = line.match(
      /^\s*(?:-\s+)?uses:\s*(?:"([^"\s#]+)"|'([^'\s#]+)'|([^"'\s#]+))(?:\s+(#.*))?\s*$/u
    );
    const reference = match?.[1] ?? match?.[2] ?? match?.[3];

    return reference === undefined
      ? []
      : [
          {
            line: index + 1,
            reference,
            versionComment: match?.[4]
          }
        ];
  });
}

function permissionOccurrences(
  value: unknown,
  path: string[] = []
): PermissionOccurrence[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      permissionOccurrences(item, [...path, String(index)])
    );
  }
  if (typeof value !== "object" || value === null) {
    return [];
  }

  return Object.entries(value).flatMap(([key, nestedValue]) =>
    key === "permissions"
      ? [{ path: [...path, key], value: nestedValue }]
      : permissionOccurrences(nestedValue, [...path, key])
  );
}

function assertImmutableActionReferences(
  workflow: Workflow,
  source: string
): void {
  const declaredReferences = actionReferences(workflow).toSorted();
  const sourceReferences = actionOccurrences(source);

  expect(sourceReferences.map(({ reference }) => reference).toSorted()).toEqual(
    declaredReferences
  );
  for (const occurrence of sourceReferences) {
    expect(occurrence.reference).toMatch(ACTION_REFERENCE);
    expect(occurrence.versionComment).toMatch(VERSION_COMMENT);
  }
}

function assertExactWorkflowPermissions(
  workflow: Workflow,
  expected: Record<string, string>
): void {
  expect(permissionOccurrences(workflow)).toEqual([
    { path: ["permissions"], value: expected }
  ]);
}

function assertImmutableWorkflowSources(
  workflows: WorkflowSource[],
  permissionProfiles = WORKFLOW_PERMISSION_PROFILES
): void {
  expect(workflows.map(({ path }) => path)).toEqual(
    Object.keys(permissionProfiles).toSorted()
  );

  for (const { path, source } of workflows) {
    expect(path.endsWith(".yml") || path.endsWith(".yaml")).toBe(true);
    const expectedPermissions = permissionProfiles[path];
    expect(expectedPermissions).toBeDefined();
    if (expectedPermissions === undefined) {
      continue;
    }

    const workflow = parse(source) as Workflow;
    assertImmutableActionReferences(workflow, source);
    assertExactWorkflowPermissions(workflow, expectedPermissions);
  }
}

function eventNames(trigger: unknown): string[] {
  if (typeof trigger === "string") {
    return [trigger];
  }
  if (Array.isArray(trigger)) {
    return trigger.filter(
      (value): value is string => typeof value === "string"
    );
  }
  if (typeof trigger === "object" && trigger !== null) {
    return Object.keys(trigger);
  }
  return [];
}

function assertGroupedNonMajorUpdates(update: DependabotUpdate): void {
  expect(update.groups).toBeTypeOf("object");
  expect(update.groups).not.toBeNull();
  expect(Object.values(update.groups as Record<string, unknown>)).toEqual([
    {
      patterns: ["*"],
      "update-types": ["minor", "patch"]
    }
  ]);
}

test("pins every external workflow action to an immutable SHA with a version comment", async () => {
  const workflows = await readWorkflowSources();

  expect(workflows).not.toHaveLength(0);
  expect(workflows.map(({ path }) => path)).toEqual(
    workflows.map(({ path }) => path).toSorted()
  );
  assertImmutableWorkflowSources(workflows);
});

test("includes sorted, deduplicated .yml and .yaml workflow paths", () => {
  expect(
    workflowFileNames([
      "dependency-review.yml",
      "unsafe.yaml",
      "ci.yml",
      "unsafe.yaml",
      "README.md"
    ])
  ).toEqual(["ci.yml", "dependency-review.yml", "unsafe.yaml"]);
});

test("discovers a safe in-memory .yaml workflow without creating a fixture file", async () => {
  const workflows = await workflowSourcesFromEntries(
    ["ignored.txt", "safe.yaml", "safe.yaml"],
    async (path) => {
      expect(path).toBe("safe.yaml");
      return `permissions:
  contents: read
jobs:
  validate:
    steps:
      - uses: ${CHECKOUT_ACTION} # v7
`;
    }
  );

  expect(() =>
    assertImmutableWorkflowSources(workflows, {
      "safe.yaml": READ_ONLY_PERMISSIONS
    })
  ).not.toThrow();
});

test("discovers and rejects an unsafe in-memory .yaml workflow without creating a fixture file", async () => {
  const workflows = await workflowSourcesFromEntries(
    ["unsafe.yaml"],
    async () =>
      "jobs:\n  validate:\n    steps:\n      - uses: actions/checkout@v7 # v7\n"
  );

  expect(() =>
    assertImmutableWorkflowSources(workflows, {
      "unsafe.yaml": READ_ONLY_PERMISSIONS
    })
  ).toThrow();
});

test("rejects a job permission override in a discovered workflow", async () => {
  const workflows = await workflowSourcesFromEntries(
    ["unsafe.yml"],
    async () => `permissions:
  contents: read
jobs:
  validate:
    permissions:
      contents: write
`
  );

  expect(() =>
    assertImmutableWorkflowSources(workflows, {
      "unsafe.yml": READ_ONLY_PERMISSIONS
    })
  ).toThrow();
});

test("rejects a duplicate action occurrence missing its adjacent version comment", () => {
  const source = `jobs:
  validate:
    steps:
      - uses: ${CHECKOUT_ACTION} # v7
      - uses: ${CHECKOUT_ACTION}
`;

  expect(() =>
    assertImmutableActionReferences(parse(source) as Workflow, source)
  ).toThrow();
});

test("rejects a non-version action comment", () => {
  const source = `jobs:
  validate:
    steps:
      - uses: ${CHECKOUT_ACTION} # velocity
`;

  expect(() =>
    assertImmutableActionReferences(parse(source) as Workflow, source)
  ).toThrow();
});

test.each([
  ["write-all", "write-all"],
  ["read-all", "read-all"]
])(
  "rejects ambiguous workflow-level permissions: %s",
  (_description, value) => {
    const workflow: Workflow = { jobs: {}, permissions: value };

    expect(() =>
      assertExactWorkflowPermissions(workflow, READ_ONLY_PERMISSIONS)
    ).toThrow();
  }
);

test("rejects a job-level contents: write permission override", () => {
  const workflow: Workflow = {
    permissions: READ_ONLY_PERMISSIONS,
    jobs: { validate: { permissions: { contents: "write" } } }
  };

  expect(() =>
    assertExactWorkflowPermissions(workflow, READ_ONLY_PERMISSIONS)
  ).toThrow();
});

test("keeps CI read-only and uses the approved v7 action commits", async () => {
  const source = await readFile(ciFile, "utf8");
  const ci = parse(source) as Workflow;
  const references = actionReferences(ci);

  assertExactWorkflowPermissions(ci, READ_ONLY_PERMISSIONS);
  expect(references).toEqual([
    CHECKOUT_ACTION,
    SETUP_NODE_ACTION,
    CODECOV_ACTION
  ]);
  expect(actionOccurrences(source)).toEqual([
    {
      line: 16,
      reference: CHECKOUT_ACTION,
      versionComment: "# v7"
    },
    {
      line: 17,
      reference: SETUP_NODE_ACTION,
      versionComment: "# v7"
    },
    {
      line: 29,
      reference: CODECOV_ACTION,
      versionComment: "# v7.0.0"
    }
  ]);
});

test("runs explicit V8 coverage and fails CI when the public Codecov upload fails", async () => {
  const [source, packageSource] = await Promise.all([
    readFile(ciFile, "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8")
  ]);
  const ci = parse(source) as Workflow;
  const packageJson = JSON.parse(packageSource) as {
    devDependencies?: Record<string, unknown>;
    scripts?: Record<string, unknown>;
  };
  const steps = ci.jobs?.validate?.steps ?? [];

  expect(packageJson.scripts?.["test:coverage"]).toBe(
    "vitest run --coverage.enabled --coverage.provider=v8 --coverage.reporter=text --coverage.reporter=lcov"
  );
  expect(packageJson.devDependencies?.["@vitest/coverage-v8"]).toBe("^3.2.7");
  expect(steps.map(({ run }) => run).filter(Boolean)).toContain(
    "npm run test:coverage"
  );
  expect(steps.find(({ uses }) => uses === CODECOV_ACTION)).toEqual({
    name: "Upload coverage to Codecov",
    uses: CODECOV_ACTION,
    with: {
      disable_search: true,
      fail_ci_if_error: true,
      files: "./coverage/lcov.info"
    }
  });
});

test("groups weekly npm and GitHub Actions Dependabot updates without private registries", async () => {
  const dependabot = parse(
    await readFile(dependabotFile, "utf8")
  ) as DependabotConfig;

  expect(dependabot.version).toBe(2);
  expect(dependabot.registries).toBeUndefined();
  expect(dependabot.updates).toHaveLength(2);

  const updates = dependabot.updates ?? [];
  expect(
    updates.map((update) => ({
      directory: update.directory,
      ecosystem: update["package-ecosystem"],
      interval: update.schedule?.interval,
      openPullRequests: update["open-pull-requests-limit"]
    }))
  ).toEqual([
    {
      directory: "/",
      ecosystem: "npm",
      interval: "weekly",
      openPullRequests: 5
    },
    {
      directory: "/",
      ecosystem: "github-actions",
      interval: "weekly",
      openPullRequests: 5
    }
  ]);

  for (const update of updates) {
    expect(update.registries).toBeUndefined();
    assertGroupedNonMajorUpdates(update);
  }
});

test("runs high-severity dependency review only for public pull requests", async () => {
  const source = await readFile(dependencyReviewFile, "utf8");
  const workflow = parse(source) as Workflow;
  const jobs = workflow.jobs ?? {};
  const dependencyReview = jobs["dependency-review"];

  expect(eventNames(workflow.on)).toEqual(["pull_request"]);
  assertExactWorkflowPermissions(workflow, READ_ONLY_PERMISSIONS);
  expect(Object.keys(jobs)).toEqual(["dependency-review"]);
  expect(dependencyReview?.if).toBe(
    "${{ github.event.repository.visibility == 'public' }}"
  );
  expect(actionReferences(dependencyReview)).toEqual([
    DEPENDENCY_REVIEW_ACTION
  ]);
  expect(actionOccurrences(source)).toEqual([
    {
      line: 14,
      reference: DEPENDENCY_REVIEW_ACTION,
      versionComment: "# v5.0.0"
    }
  ]);
  expect(dependencyReview?.steps?.[0]?.with).toEqual({
    "fail-on-severity": "high"
  });
});

test("runs JavaScript and TypeScript CodeQL only for public repository events", async () => {
  const source = await readFile(codeqlFile, "utf8");
  const workflow = parse(source) as Workflow;
  const jobs = workflow.jobs ?? {};
  const codeql = jobs.codeql;

  expect(eventNames(workflow.on)).toEqual(["pull_request", "push", "schedule"]);
  expect(workflow.on).toEqual({
    pull_request: null,
    push: { branches: ["main"] },
    schedule: [{ cron: "17 3 * * 5" }]
  });
  expect(workflow.concurrency).toEqual({
    group: "codeql-${{ github.workflow }}-${{ github.ref }}",
    "cancel-in-progress": true
  });
  assertExactWorkflowPermissions(workflow, CODEQL_PERMISSIONS);
  expect(Object.keys(jobs)).toEqual(["codeql"]);
  expect(codeql?.if).toBe(
    "${{ github.event.repository.visibility == 'public' }}"
  );
  expect((codeql as { "runs-on"?: unknown } | undefined)?.["runs-on"]).toBe(
    "ubuntu-latest"
  );
  expect(actionReferences(codeql)).toEqual([
    CHECKOUT_ACTION,
    CODEQL_INIT_ACTION,
    CODEQL_ANALYZE_ACTION
  ]);
  expect(codeql?.steps).toHaveLength(3);
  expect(actionOccurrences(source)).toEqual([
    {
      line: 26,
      reference: CHECKOUT_ACTION,
      versionComment: "# v7"
    },
    {
      line: 28,
      reference: CODEQL_INIT_ACTION,
      versionComment: "# v4.37.9"
    },
    {
      line: 32,
      reference: CODEQL_ANALYZE_ACTION,
      versionComment: "# v4.37.9"
    }
  ]);
  expect(codeql?.steps?.[1]?.with).toEqual({
    languages: "javascript-typescript"
  });
  expect(codeql?.steps?.[2]?.with).toBeUndefined();
});
