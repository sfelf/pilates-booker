import {
  cp,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser } from "playwright";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
  vi
} from "vitest";
import { createBookingPage, type BookingBrowser } from "../src/booking-page.js";
import { runCommand } from "../src/command.js";
import { RESULT_DETAILS, type BookingResult } from "../src/contracts.js";
import { validateResult } from "../src/result-validator.js";
import { calendarPageHtml } from "./fixtures/calendar.js";
import { bookingPageHtml } from "./fixtures/checkout.js";

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser.close();
});
afterEach(() => vi.restoreAllMocks());

const checkoutUrl =
  "https://app.arketa.co/iframe/synthetic/calendar/checkout/e2e";
const discoveryCalendarUrl =
  "https://app.arketa.co/iframe/synthetic-studio/calendar";
const discoveryCheckoutUrl =
  "https://app.arketa.co/iframe/synthetic-studio/calendar/checkout/discovery-e2e";
const discoveryStart = new Date();
discoveryStart.setUTCHours(12, 0, 0, 0);
discoveryStart.setUTCDate(
  discoveryStart.getUTCDate() - discoveryStart.getUTCDay()
);
const discoveryStartWeek = discoveryStart.toISOString().slice(0, 10);
const discoveryClassDate = new Date(discoveryStart);
discoveryClassDate.setUTCDate(discoveryClassDate.getUTCDate() + 12 * 7 + 3);
const observedClass = {
  name: "Reformer – Début ✨",
  instructor: "Ana O’Neil",
  date: "2026-09-01",
  start_time: "09:30",
  end_time: "10:20",
  timezone: "America/Los_Angeles"
} as const;
const discoveryObservedClass = {
  ...observedClass,
  date: discoveryClassDate.toISOString().slice(0, 10)
} as const;
type Scenario = Readonly<{
  name: string;
  action: "book" | "waitlist" | "already_booked" | "already_waitlisted";
  dryRun: boolean;
  expected: BookingResult;
  observation: BuiltCommandObservation;
}>;
type BuiltCommandObservation = Readonly<{
  myself_selected: boolean;
  injuries_value: string;
  selected_package_rows: readonly number[];
  cancellation_accepted: boolean;
  submissions: number;
  browser_contexts?: number;
  pages?: number;
  calendar_navigations?: number;
  checkout_navigations?: number;
  calendar_week_clicks?: number;
  calendar_checkout_clicks?: number;
  myself_selections?: number;
  injury_fills?: number;
  package_selections?: number;
  cancellation_acceptances?: number;
}>;
type DiscoveryFixtureFailure =
  | "pre_submission"
  | "post_submit"
  | "checkout_redirect";
type DiscoveryScenario = Readonly<{
  name: string;
  action: Scenario["action"];
  dryRun: boolean;
  startWeek: string;
  classes: readonly Readonly<{
    name: string;
    date: string;
    time: string;
    href: string;
  }>[];
  checkoutClassName?: string;
  failure?: DiscoveryFixtureFailure;
  expected: BookingResult;
  observation: BuiltCommandObservation;
}>;
const packagesBefore = [
  {
    name: "Studio / 10-Class Pack",
    remaining: 3,
    approved: true
  },
  {
    name: "Intro / 5-Class Pack",
    remaining: 1,
    approved: false
  }
] as const;
const completeSafetyChecks = {
  approved_package_verified: true,
  no_charge: true,
  cancellation_policy_accepted: true
} as const;
const incompleteSafetyChecks = {
  approved_package_verified: false,
  no_charge: false,
  cancellation_policy_accepted: false
} as const;
const liveObservation = {
  myself_selected: true,
  injuries_value: "None",
  selected_package_rows: [0],
  cancellation_accepted: true,
  submissions: 1
} as const;
const untouchedObservation = {
  myself_selected: false,
  injuries_value: "",
  selected_package_rows: [],
  cancellation_accepted: false,
  submissions: 0
} as const;
const discoveryUntouchedObservation = {
  myself_selected: false,
  injuries_value: "",
  selected_package_rows: [],
  cancellation_accepted: false,
  submissions: 0,
  browser_contexts: 1,
  pages: 1,
  calendar_navigations: 1,
  checkout_navigations: 1,
  calendar_week_clicks: 12,
  calendar_checkout_clicks: 0,
  myself_selections: 0,
  injury_fills: 0,
  package_selections: 0,
  cancellation_acceptances: 0
} as const;
const discoveryLiveObservation = {
  ...discoveryUntouchedObservation,
  myself_selected: true,
  injuries_value: "None",
  selected_package_rows: [0],
  cancellation_accepted: true,
  submissions: 1,
  myself_selections: 1,
  injury_fills: 1,
  package_selections: 1,
  cancellation_acceptances: 1
} as const;
const evidenceFreeSafeStop: BookingResult = {
  schema_version: 2,
  outcome: "SAFE_STOP",
  exit_code: 20,
  action_submitted: false,
  confirmation_verified: false,
  safety_checks: incompleteSafetyChecks,
  details: RESULT_DETAILS.SAFE_STOP
};
const discoveryClasses = [
  {
    name: discoveryObservedClass.name,
    date: discoveryObservedClass.date,
    time: "9:30 AM",
    href: discoveryCheckoutUrl
  }
] as const;
const scenarios: readonly Scenario[] = [
  {
    name: "confirmed booking",
    action: "book",
    dryRun: false,
    expected: {
      schema_version: 2,
      outcome: "BOOKED",
      exit_code: 0,
      action_submitted: true,
      confirmation_verified: true,
      observed_class: observedClass,
      package_selected: "Studio / 10-Class Pack",
      packages_before: packagesBefore,
      google_calendar_url:
        "https://app.arketa.co/api/calendar/google?classId=e2e",
      safety_checks: completeSafetyChecks,
      details: RESULT_DETAILS.BOOKED
    },
    observation: liveObservation
  },
  {
    name: "confirmed waitlist",
    action: "waitlist",
    dryRun: false,
    expected: {
      schema_version: 2,
      outcome: "WAITLISTED",
      exit_code: 0,
      action_submitted: true,
      confirmation_verified: true,
      observed_class: observedClass,
      package_selected: "Studio / 10-Class Pack",
      packages_before: packagesBefore,
      safety_checks: completeSafetyChecks,
      details: RESULT_DETAILS.WAITLISTED
    },
    observation: liveObservation
  },
  {
    name: "actionable booking dry run",
    action: "book",
    dryRun: true,
    expected: {
      schema_version: 2,
      outcome: "DRY_RUN",
      exit_code: 0,
      action_submitted: false,
      confirmation_verified: false,
      availability: "BOOKING_AVAILABLE",
      observed_class: observedClass,
      package_selected: "Studio / 10-Class Pack",
      packages_before: packagesBefore,
      safety_checks: {
        approved_package_verified: true,
        no_charge: false,
        cancellation_policy_accepted: false
      },
      details: RESULT_DETAILS.DRY_RUN
    },
    observation: untouchedObservation
  },
  {
    name: "actionable waitlist dry run",
    action: "waitlist",
    dryRun: true,
    expected: {
      schema_version: 2,
      outcome: "DRY_RUN",
      exit_code: 0,
      action_submitted: false,
      confirmation_verified: false,
      availability: "WAITLIST_AVAILABLE",
      observed_class: observedClass,
      package_selected: "Studio / 10-Class Pack",
      packages_before: packagesBefore,
      safety_checks: {
        approved_package_verified: true,
        no_charge: false,
        cancellation_policy_accepted: false
      },
      details: RESULT_DETAILS.DRY_RUN
    },
    observation: untouchedObservation
  },
  {
    name: "authoritative existing booking",
    action: "already_booked",
    dryRun: false,
    expected: {
      schema_version: 2,
      outcome: "ALREADY_BOOKED",
      exit_code: 0,
      action_submitted: false,
      confirmation_verified: true,
      observed_class: observedClass,
      safety_checks: incompleteSafetyChecks,
      details: RESULT_DETAILS.ALREADY_BOOKED
    },
    observation: untouchedObservation
  },
  {
    name: "authoritative existing waitlist",
    action: "already_waitlisted",
    dryRun: false,
    expected: {
      schema_version: 2,
      outcome: "ALREADY_WAITLISTED",
      exit_code: 0,
      action_submitted: false,
      confirmation_verified: true,
      observed_class: observedClass,
      safety_checks: incompleteSafetyChecks,
      details: RESULT_DETAILS.ALREADY_WAITLISTED
    },
    observation: untouchedObservation
  }
];

const discoveryScenarios: readonly DiscoveryScenario[] = [
  {
    name: "actionable dry run at the twelfth following week",
    action: "book",
    dryRun: true,
    startWeek: discoveryStartWeek,
    classes: discoveryClasses,
    expected: {
      schema_version: 2,
      outcome: "DRY_RUN",
      exit_code: 0,
      action_submitted: false,
      confirmation_verified: false,
      availability: "BOOKING_AVAILABLE",
      observed_class: discoveryObservedClass,
      package_selected: "Studio / 10-Class Pack",
      packages_before: packagesBefore,
      safety_checks: {
        approved_package_verified: true,
        no_charge: false,
        cancellation_policy_accepted: false
      },
      details: RESULT_DETAILS.DRY_RUN
    },
    observation: {
      ...discoveryUntouchedObservation,
      calendar_week_clicks: 12
    }
  },
  {
    name: "existing-enrollment dry run",
    action: "already_booked",
    dryRun: true,
    startWeek: discoveryStartWeek,
    classes: discoveryClasses,
    expected: {
      schema_version: 2,
      outcome: "DRY_RUN",
      exit_code: 0,
      action_submitted: false,
      confirmation_verified: true,
      availability: "ALREADY_BOOKED",
      observed_class: discoveryObservedClass,
      safety_checks: incompleteSafetyChecks,
      details: RESULT_DETAILS.DRY_RUN
    },
    observation: discoveryUntouchedObservation
  },
  {
    name: "confirmed booking",
    action: "book",
    dryRun: false,
    startWeek: discoveryStartWeek,
    classes: discoveryClasses,
    expected: {
      schema_version: 2,
      outcome: "BOOKED",
      exit_code: 0,
      action_submitted: true,
      confirmation_verified: true,
      observed_class: discoveryObservedClass,
      package_selected: "Studio / 10-Class Pack",
      packages_before: packagesBefore,
      google_calendar_url:
        "https://app.arketa.co/api/calendar/google?classId=discovery-e2e",
      safety_checks: completeSafetyChecks,
      details: RESULT_DETAILS.BOOKED
    },
    observation: discoveryLiveObservation
  },
  {
    name: "confirmed waitlist",
    action: "waitlist",
    dryRun: false,
    startWeek: discoveryStartWeek,
    classes: discoveryClasses,
    expected: {
      schema_version: 2,
      outcome: "WAITLISTED",
      exit_code: 0,
      action_submitted: true,
      confirmation_verified: true,
      observed_class: discoveryObservedClass,
      package_selected: "Studio / 10-Class Pack",
      packages_before: packagesBefore,
      safety_checks: completeSafetyChecks,
      details: RESULT_DETAILS.WAITLISTED
    },
    observation: discoveryLiveObservation
  },
  {
    name: "authoritative existing booking",
    action: "already_booked",
    dryRun: false,
    startWeek: discoveryStartWeek,
    classes: discoveryClasses,
    expected: {
      schema_version: 2,
      outcome: "ALREADY_BOOKED",
      exit_code: 0,
      action_submitted: false,
      confirmation_verified: true,
      observed_class: discoveryObservedClass,
      safety_checks: incompleteSafetyChecks,
      details: RESULT_DETAILS.ALREADY_BOOKED
    },
    observation: discoveryUntouchedObservation
  },
  {
    name: "authoritative existing waitlist",
    action: "already_waitlisted",
    dryRun: false,
    startWeek: discoveryStartWeek,
    classes: discoveryClasses,
    expected: {
      schema_version: 2,
      outcome: "ALREADY_WAITLISTED",
      exit_code: 0,
      action_submitted: false,
      confirmation_verified: true,
      observed_class: discoveryObservedClass,
      safety_checks: incompleteSafetyChecks,
      details: RESULT_DETAILS.ALREADY_WAITLISTED
    },
    observation: discoveryUntouchedObservation
  },
  {
    name: "no exact calendar match",
    action: "book",
    dryRun: false,
    startWeek: discoveryStartWeek,
    classes: [
      {
        ...discoveryClasses[0],
        name: "Synthetic Mat Fundamentals"
      }
    ],
    expected: evidenceFreeSafeStop,
    observation: {
      ...discoveryUntouchedObservation,
      checkout_navigations: 0
    }
  },
  {
    name: "ambiguous exact calendar match",
    action: "book",
    dryRun: false,
    startWeek: discoveryStartWeek,
    classes: [...discoveryClasses, ...discoveryClasses],
    expected: evidenceFreeSafeStop,
    observation: {
      ...discoveryUntouchedObservation,
      checkout_navigations: 0
    }
  },
  {
    name: "checkout identity mismatch",
    action: "book",
    dryRun: false,
    startWeek: discoveryStartWeek,
    classes: discoveryClasses,
    checkoutClassName: "Synthetic Mat Fundamentals",
    expected: evidenceFreeSafeStop,
    observation: discoveryUntouchedObservation
  },
  {
    name: "pre-submission browser failure",
    action: "book",
    dryRun: false,
    startWeek: discoveryStartWeek,
    classes: discoveryClasses,
    failure: "pre_submission",
    expected: {
      schema_version: 2,
      outcome: "TECHNICAL_FAILURE",
      exit_code: 30,
      action_submitted: false,
      confirmation_verified: false,
      safety_checks: incompleteSafetyChecks,
      details: RESULT_DETAILS.TECHNICAL_FAILURE
    },
    observation: {
      ...discoveryUntouchedObservation,
      checkout_navigations: 1
    }
  },
  {
    name: "redirected checkout navigation",
    action: "book",
    dryRun: false,
    startWeek: discoveryStartWeek,
    classes: discoveryClasses,
    failure: "checkout_redirect",
    expected: {
      schema_version: 2,
      outcome: "TECHNICAL_FAILURE",
      exit_code: 30,
      action_submitted: false,
      confirmation_verified: false,
      safety_checks: incompleteSafetyChecks,
      details: RESULT_DETAILS.TECHNICAL_FAILURE
    },
    observation: discoveryUntouchedObservation
  },
  {
    name: "post-submit confirmation failure",
    action: "book",
    dryRun: false,
    startWeek: discoveryStartWeek,
    classes: discoveryClasses,
    failure: "post_submit",
    expected: {
      schema_version: 2,
      outcome: "CONFIRMATION_UNCERTAIN",
      exit_code: 40,
      action_submitted: true,
      confirmation_verified: false,
      safety_checks: completeSafetyChecks,
      details: RESULT_DETAILS.CONFIRMATION_UNCERTAIN
    },
    observation: discoveryLiveObservation
  }
];

test("public command reports a fixed diagnostic when bootstrap import fails", async () => {
  const fixtureDirectory = await mkdtemp(
    join(tmpdir(), "pilates-bootstrap-failure-e2e-")
  );
  const markerPath = join(fixtureDirectory, "loader-fired");
  const registerPath = fileURLToPath(
    new URL(
      "./fixtures/built-command-bootstrap-failure-register.mjs",
      import.meta.url
    )
  );
  const mainPath = fileURLToPath(new URL("../dist/main.js", import.meta.url));
  const child = spawn(process.execPath, ["--import", registerPath, mainPath], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: {
      ...process.env,
      PILATES_BOOKER_BOOTSTRAP_FAILURE_MARKER: markerPath
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("bootstrap failure child process timed out"));
    }, 5_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });

  expect(exitCode).toBe(30);
  expect(stdout).toBe("");
  expect(stderr).toBe("Booking command failed.\n");
  expect(stderr).not.toContain("synthetic private bootstrap failure");
  expect(stderr).not.toContain("built-command-bootstrap-failure-loader.mjs");
  expect(stderr).not.toContain(registerPath);
  expect(stderr).not.toContain(mainPath);
  expect(await readFile(markerPath, "utf8")).toBe("injected\n");
});

test("built command projects child diagnostics when observation is missing", async () => {
  const fixtureDirectory = await mkdtemp(
    join(tmpdir(), "pilates-diagnostics-e2e-")
  );
  const registerPath = join(fixtureDirectory, "child-failure.mjs");
  const rawMarker =
    "synthetic-private-secret /private/synthetic/observation-path";
  const escapedMarker =
    "synthetic-private-secret \\u002fprivate\\u002fsynthetic\\u002fobservation-path";
  const encodedMarker =
    "synthetic-private-secret%20%2Fprivate%2Fsynthetic%2Fobservation-path";
  const repeatedEncodedMarker =
    "synthetic-private-secret%2520%252Fprivate%252Fsynthetic%252Fobservation-path";
  await writeFile(
    registerPath,
    [
      `process.stdout.write(${JSON.stringify(`${rawMarker}\n${escapedMarker}\n`)});`,
      `process.stderr.write(${JSON.stringify(`${encodedMarker}\n${repeatedEncodedMarker}\n`)});`,
      "process.exit(17);"
    ].join("\n"),
    "utf8"
  );

  const failure = await runBuiltCommand([], "book", {
    calendarHtml: "",
    checkoutHtml: "",
    registerPath
  }).then(
    () => {
      throw new Error("built command unexpectedly succeeded");
    },
    (error: unknown) => error
  );
  expect(failure).toBeInstanceOf(Error);
  const message = (failure as Error).message;
  expect(message).toBe(
    "Built command failed before observation (exit code 17; stdout <captured>; stderr <captured>)"
  );
  for (const marker of [
    rawMarker,
    escapedMarker,
    encodedMarker,
    repeatedEncodedMarker,
    "ENOENT",
    fixtureDirectory
  ]) {
    expect(message).not.toContain(marker);
  }
  expect(failure).not.toHaveProperty("cause");
});

test("built command requires observation unless explicitly allowed", async () => {
  const fixtureDirectory = await mkdtemp(
    join(tmpdir(), "pilates-observation-required-e2e-")
  );
  const registerPath = join(fixtureDirectory, "observation-free.mjs");
  await writeFile(registerPath, "process.exit(0);\n", "utf8");

  const defaultFailure = await runBuiltCommand([], "book", {
    calendarHtml: "",
    checkoutHtml: "",
    registerPath
  }).then(
    () => {
      throw new Error("built command unexpectedly succeeded");
    },
    (error: unknown) => error
  );
  expect(defaultFailure).toBeInstanceOf(Error);
  expect((defaultFailure as Error).message).toBe(
    "Built command failed before observation (exit code 0; stdout <empty>; stderr <empty>)"
  );
  await expect(
    runBuiltCommand([], "book", {
      calendarHtml: "",
      checkoutHtml: "",
      registerPath,
      allowMissingObservation: true
    })
  ).resolves.toEqual({ exitCode: 0, stdout: "", stderr: "" });
});

test("copied built command retains its build-time version snapshot", async () => {
  const projectDirectory = fileURLToPath(new URL("..", import.meta.url));
  const sourcePackage = JSON.parse(
    await readFile(join(projectDirectory, "package.json"), "utf8")
  ) as Record<string, unknown> & { version: string };
  const fixtureDirectory = await mkdtemp(
    join(projectDirectory, ".pilates-version-e2e-")
  );
  try {
    await cp(join(projectDirectory, "dist"), join(fixtureDirectory, "dist"), {
      recursive: true
    });
    await cp(
      join(projectDirectory, "schemas"),
      join(fixtureDirectory, "schemas"),
      { recursive: true }
    );
    await writeFile(
      join(fixtureDirectory, "package.json"),
      `${JSON.stringify({ ...sourcePackage, version: "9.8.7" })}\n`,
      "utf8"
    );

    const child = spawn(
      process.execPath,
      [join(fixtureDirectory, "dist", "main.js"), "--version"],
      {
        cwd: fixtureDirectory,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });

    expect({ exitCode, stdout, stderr }).toEqual({
      exitCode: 0,
      stdout: `pilates-booker ${sourcePackage.version}\n`,
      stderr: ""
    });
  } finally {
    await rm(fixtureDirectory, { recursive: true, force: true });
  }
});

describe.each(scenarios)("public command: $name", (scenario) => {
  test("executes dist/main.js and emits one exact result with bounded mutation", async () => {
    const runtime = await mkdtemp(join(tmpdir(), "pilates-e2e-"));
    const argv = [
      "--booking-url",
      checkoutUrl,
      "--allow-package",
      "Studio / 10-Class Pack",
      "--runtime",
      runtime,
      ...(scenario.dryRun ? ["--dry-run"] : [])
    ];
    const invocation = await runBuiltCommand(argv, scenario.action);
    expect(invocation.exitCode).toBe(0);
    expect(invocation.stderr).toBe("");
    const result = JSON.parse(invocation.stdout) as BookingResult;
    expect(invocation.stdout).toBe(`${JSON.stringify(result)}\n`);
    expect(validateResult(result)).toBe(true);
    expect(result).toEqual(scenario.expected);
    expect(invocation.observation).toEqual(scenario.observation);
    expect(
      (await readdir(runtime)).every(
        (name) => !["journals", "results"].includes(name)
      )
    ).toBe(true);
  });
});

describe.each(discoveryScenarios)(
  "public discovery command: $name",
  (scenario) => {
    test("executes dist/main.js through one bounded synthetic browser session", async () => {
      const runtime = await mkdtemp(join(tmpdir(), "pilates-discovery-e2e-"));
      const argv = [
        "--calendar-url",
        discoveryCalendarUrl,
        "--class-name",
        discoveryObservedClass.name,
        "--class-date",
        discoveryObservedClass.date,
        "--class-time",
        discoveryObservedClass.start_time,
        "--allow-package",
        "Studio / 10-Class Pack",
        "--runtime",
        runtime,
        ...(scenario.dryRun ? ["--dry-run"] : [])
      ];
      const checkoutHtml = bookingPageHtml({
        action: scenario.action,
        myselfSelected: false,
        injuries: [""],
        selectedPackageRows: [],
        classDate: discoveryObservedClass.date
      }).replaceAll(
        discoveryObservedClass.name,
        scenario.checkoutClassName ?? discoveryObservedClass.name
      );
      const invocation = await runBuiltCommand(argv, scenario.action, {
        calendarHtml: calendarPageHtml({
          startWeek: scenario.startWeek,
          classes: scenario.classes
        }),
        checkoutHtml,
        ...(scenario.failure === undefined ? {} : { failure: scenario.failure })
      });

      expect(invocation.exitCode).toBe(scenario.expected.exit_code);
      expect(invocation.stderr).toBe("");
      const result = JSON.parse(invocation.stdout) as BookingResult;
      expect(invocation.stdout).toBe(`${JSON.stringify(result)}\n`);
      expect(validateResult(result)).toBe(true);
      expect(result).toEqual(scenario.expected);
      expect(invocation.observation).toEqual(scenario.observation);
      expect(
        (await readdir(runtime)).every(
          (name) => !["journals", "results"].includes(name)
        )
      ).toBe(true);
    });
  }
);

test("a repeated built command reconciles through authoritative Arketa evidence", async () => {
  const runtime = await mkdtemp(join(tmpdir(), "pilates-repeat-e2e-"));
  const argv = [
    "--booking-url",
    checkoutUrl,
    "--allow-package",
    "Studio / 10-Class Pack",
    "--runtime",
    runtime
  ];

  const first = await runBuiltCommand(argv, "book");
  const second = await runBuiltCommand(argv, "already_booked");

  expect(JSON.parse(first.stdout)).toEqual(scenarios[0]?.expected);
  expect(first.observation).toBeDefined();
  const firstObservation = first.observation;
  if (firstObservation === undefined) {
    throw new Error("built booking observation unexpectedly missing");
  }
  expect(firstObservation.submissions).toBe(1);
  expect(JSON.parse(second.stdout)).toEqual(scenarios[4]?.expected);
  expect(second.observation).toEqual(untouchedObservation);
  expect(first.stderr).toBe("");
  expect(second.stderr).toBe("");
  expect(first.exitCode).toBe(0);
  expect(second.exitCode).toBe(0);
  expect(await readdir(runtime)).toEqual([]);
});

async function runBuiltCommand(
  argv: readonly string[],
  action: Scenario["action"],
  discoveryFixture?: Readonly<{
    calendarHtml: string;
    checkoutHtml: string;
    failure?: DiscoveryFixtureFailure;
    registerPath?: string;
    allowMissingObservation?: boolean;
  }>
): Promise<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
  observation?: BuiltCommandObservation;
}> {
  const fixtureDirectory = await mkdtemp(join(tmpdir(), "pilates-built-e2e-"));
  const fixturePath = join(fixtureDirectory, "fixture.json");
  const observationPath = join(fixtureDirectory, "observation.json");
  await writeFile(
    fixturePath,
    JSON.stringify({
      html:
        discoveryFixture?.checkoutHtml ??
        bookingPageHtml({
          action,
          myselfSelected: false,
          injuries: [""],
          selectedPackageRows: []
        }),
      ...(discoveryFixture === undefined
        ? {}
        : {
            calendar_html: discoveryFixture.calendarHtml,
            checkout_html: discoveryFixture.checkoutHtml,
            ...(discoveryFixture.failure === undefined
              ? {}
              : { failure: discoveryFixture.failure })
          }),
      observation_path: observationPath
    }),
    "utf8"
  );
  const registerPath =
    discoveryFixture?.registerPath ??
    fileURLToPath(
      new URL("./fixtures/built-command-register.mjs", import.meta.url)
    );
  const mainPath = fileURLToPath(new URL("../dist/main.js", import.meta.url));
  const child = spawn(
    process.execPath,
    ["--import", registerPath, mainPath, ...argv],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: {
        ...process.env,
        PILATES_BOOKER_E2E_FIXTURE: fixturePath
      },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  let observation: BuiltCommandObservation | undefined;
  let observationReadError: unknown;
  try {
    observation = JSON.parse(
      await readFile(observationPath, "utf8")
    ) as BuiltCommandObservation;
  } catch (error) {
    observationReadError = error;
  }
  if (observationReadError !== undefined) {
    if ((observationReadError as NodeJS.ErrnoException).code !== "ENOENT") {
      throw observationReadError;
    }
    const missingObservationAllowed =
      discoveryFixture?.allowMissingObservation === true && exitCode === 0;
    if (!missingObservationAllowed) {
      throw new Error(
        `Built command failed before observation (exit code ${String(exitCode)}; stdout ${projectBuiltCommandDiagnostic(stdout)}; stderr ${projectBuiltCommandDiagnostic(stderr)})`
      );
    }
  }
  return {
    exitCode,
    stdout,
    stderr,
    ...(observation === undefined ? {} : { observation })
  };
}

function projectBuiltCommandDiagnostic(
  value: string
): "<empty>" | "<captured>" {
  return value.length === 0 ? "<empty>" : "<captured>";
}

test("debug is opt-in and writes only the bounded runtime log", async () => {
  const runtime = await mkdtemp(join(tmpdir(), "pilates-debug-e2e-"));
  const bookingBrowser: BookingBrowser = async (_profile, input, use) => {
    const page = await browser.newPage();
    try {
      await page.setContent(bookingPageHtml({ action: "already_booked" }));
      return await use(createBookingPage(page), {
        checkoutUrl: input.entry_mode === "checkout" ? input.booking_url : ""
      });
    } finally {
      await page.close();
    }
  };
  const base = [
    "--booking-url",
    checkoutUrl,
    "--allow-package",
    "Studio / 10-Class Pack",
    "--runtime",
    runtime
  ];
  expect(
    await runCommand(base, {
      bookingBrowser,
      emitResult: async () => undefined
    })
  ).toBe(0);
  expect(await readdir(runtime)).not.toContain("pilates-booker.log");
  expect(
    await runCommand([...base, "--debug"], {
      bookingBrowser,
      emitResult: async () => undefined
    })
  ).toBe(0);
  const records = (await readFile(join(runtime, "pilates-booker.log"), "utf8"))
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(records[0]).toMatchObject({
    event: "command.started",
    data: { arguments: { booking_url: checkoutUrl, debug: true } }
  });
  expect(records.at(-1)).toMatchObject({
    event: "response.emitted",
    response_emitted: true
  });
  expect(await readdir(runtime)).not.toContain("journals");
  expect(await readdir(runtime)).not.toContain("results");
});

test("public command recovers a lock whose PID is conclusively absent", async () => {
  const runtime = await mkdtemp(join(tmpdir(), "pilates-stale-e2e-"));
  const lockPath = join(runtime, "run.lock");
  const staleLock = `${JSON.stringify({ version: 2, pid: 77 })}\n`;
  await writeFile(lockPath, staleLock, "utf8");
  vi.spyOn(process, "kill").mockImplementation(() => {
    throw Object.assign(new Error("synthetic private process message"), {
      code: "ESRCH"
    });
  });
  let browserInvocations = 0;
  const bookingBrowser: BookingBrowser = async (_profile, input, use) => {
    browserInvocations += 1;
    const page = await browser.newPage();
    try {
      await page.setContent(bookingPageHtml({ action: "already_booked" }));
      return await use(createBookingPage(page), {
        checkoutUrl: input.entry_mode === "checkout" ? input.booking_url : ""
      });
    } finally {
      await page.close();
    }
  };
  let stdout = "";

  const exit = await runCommand(
    [
      "--booking-url",
      checkoutUrl,
      "--allow-package",
      "Studio / 10-Class Pack",
      "--runtime",
      runtime
    ],
    {
      bookingBrowser,
      emitResult: async (bytes) => {
        stdout += bytes;
      }
    }
  );

  const expected: BookingResult = {
    schema_version: 2,
    outcome: "ALREADY_BOOKED",
    exit_code: 0,
    action_submitted: false,
    confirmation_verified: true,
    observed_class: observedClass,
    safety_checks: {
      approved_package_verified: false,
      no_charge: false,
      cancellation_policy_accepted: false
    },
    details: "Existing booking confirmed."
  };
  expect(exit).toBe(0);
  const parsed = JSON.parse(stdout) as BookingResult;
  expect(stdout).toBe(`${JSON.stringify(parsed)}\n`);
  expect(parsed).toEqual(expected);
  expect(validateResult(parsed)).toBe(true);
  expect(browserInvocations).toBe(1);
  expect(await readdir(runtime)).toEqual([]);
  expect(stdout).not.toContain(staleLock.trim());
});

test("public command preserves an ambiguous PID lock before browser and debug work", async () => {
  const runtime = await mkdtemp(join(tmpdir(), "pilates-lock-e2e-"));
  const lockPath = join(runtime, "run.lock");
  const ambiguousLock = `${JSON.stringify({ version: 2, pid: 77 })}\n`;
  await writeFile(lockPath, ambiguousLock, "utf8");
  vi.spyOn(process, "kill").mockImplementation(() => {
    throw Object.assign(new Error("synthetic private process message"), {
      code: "EPERM"
    });
  });
  let browserInvocations = 0;
  const bookingBrowser: BookingBrowser = async () => {
    browserInvocations += 1;
    throw new Error("browser must not open while the runtime lock is held");
  };
  let stdout = "";

  const exit = await runCommand(
    [
      "--booking-url",
      checkoutUrl,
      "--allow-package",
      "Studio / 10-Class Pack",
      "--runtime",
      runtime,
      "--debug"
    ],
    {
      bookingBrowser,
      emitResult: async (bytes) => {
        stdout += bytes;
      }
    }
  );

  const expected: BookingResult = {
    schema_version: 2,
    outcome: "TECHNICAL_FAILURE",
    exit_code: 30,
    action_submitted: false,
    confirmation_verified: false,
    safety_checks: {
      approved_package_verified: false,
      no_charge: false,
      cancellation_policy_accepted: false
    },
    details: "Runtime operation failed."
  };
  expect(exit).toBe(30);
  expect(stdout).toBe(`${JSON.stringify(expected)}\n`);
  expect(validateResult(JSON.parse(stdout))).toBe(true);
  expect(browserInvocations).toBe(0);
  expect(await readdir(runtime)).toEqual(["run.lock"]);
  expect(await readFile(lockPath, "utf8")).toBe(ambiguousLock);
  expect(stdout).not.toContain(ambiguousLock.trim());
});
