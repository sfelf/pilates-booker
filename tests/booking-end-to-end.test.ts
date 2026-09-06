import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
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
const observedClass = {
  name: "Reformer – Début ✨",
  instructor: "Ana O’Neil",
  date: "2026-09-01",
  start_time: "09:30",
  end_time: "10:20",
  timezone: "America/Los_Angeles"
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

test("public command reports a fixed diagnostic when bootstrap import fails", async () => {
  const registerPath = fileURLToPath(
    new URL(
      "./fixtures/built-command-bootstrap-failure-register.mjs",
      import.meta.url
    )
  );
  const mainPath = fileURLToPath(new URL("../dist/main.js", import.meta.url));
  const child = spawn(process.execPath, ["--import", registerPath, mainPath], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
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
  expect(first.observation.submissions).toBe(1);
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
  action: Scenario["action"]
): Promise<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
  observation: BuiltCommandObservation;
}> {
  const fixtureDirectory = await mkdtemp(join(tmpdir(), "pilates-built-e2e-"));
  const fixturePath = join(fixtureDirectory, "fixture.json");
  const observationPath = join(fixtureDirectory, "observation.json");
  await writeFile(
    fixturePath,
    JSON.stringify({
      html: bookingPageHtml({
        action,
        myselfSelected: false,
        injuries: [""],
        selectedPackageRows: []
      }),
      observation_path: observationPath
    }),
    "utf8"
  );
  const registerPath = fileURLToPath(
    new URL("./fixtures/built-command-register.mjs", import.meta.url)
  );
  const mainPath = fileURLToPath(new URL("../dist/main.js", import.meta.url));
  const child = spawn(
    process.execPath,
    ["--import", registerPath, mainPath, ...argv],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: { ...process.env, PILATES_BOOKER_E2E_FIXTURE: fixturePath },
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
  const observation = JSON.parse(
    await readFile(observationPath, "utf8")
  ) as BuiltCommandObservation;
  return { exitCode, stdout, stderr, observation };
}

test("debug is opt-in and writes only the bounded runtime log", async () => {
  const runtime = await mkdtemp(join(tmpdir(), "pilates-debug-e2e-"));
  const bookingBrowser: BookingBrowser = async (_profile, _url, use) => {
    const page = await browser.newPage();
    try {
      await page.setContent(bookingPageHtml({ action: "already_booked" }));
      return await use(createBookingPage(page));
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
  const bookingBrowser: BookingBrowser = async (_profile, _url, use) => {
    browserInvocations += 1;
    const page = await browser.newPage();
    try {
      await page.setContent(bookingPageHtml({ action: "already_booked" }));
      return await use(createBookingPage(page));
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
