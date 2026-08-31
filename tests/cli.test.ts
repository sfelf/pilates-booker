import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { describe, expect, test, vi } from "vitest";

import type {
  BookingBrowser,
  BookingPage,
  BookingPageState
} from "../src/booking-page.js";
import {
  CLI_FAILURE_DIAGNOSTIC,
  publishResult,
  runCli,
  type CliDependencies,
  type CliDiagnostic
} from "../src/cli.js";
import type {
  BookingPolicy,
  BookingRequest,
  BookingResult,
  JournalState
} from "../src/contracts.js";
import type { LockReleaseResult, ProfileLock } from "../src/lock.js";

const requestId = "00000000-0000-4000-8000-000000000003";
const evidenceName = `${requestId}.json`;
const policy: BookingPolicy = {
  schema_version: 1,
  policy_version: "2030-01-01",
  allowed_packages: ["Synthetic Priority Package"]
};
const cliArgs = ["--policy", "policy.json", "request.json"] as const;
const safetyChecks = {
  exact_class_match: false,
  approved_package_verified: false,
  no_charge: false,
  cancellation_policy_accepted: false
} as const;
const observedClass = {
  name: "Synthetic Reformer Flow",
  instructor: "Synthetic Instructor",
  date: "2030-01-16",
  start_time: "10:30",
  end_time: "11:30",
  timezone: "America/Los_Angeles"
} as const;
const packagesBefore = [
  { name: "Synthetic Priority Package", remaining: 3, approved: true }
] as const;
const request: BookingRequest = {
  schema_version: 1,
  request_id: requestId,
  booking_url:
    "https://app.arketa.co/iframe/synthetic/calendar/checkout/expected",
  expected_class: {
    name: observedClass.name,
    date: observedClass.date,
    start_time: observedClass.start_time,
    timezone: observedClass.timezone
  },
  reserve_for: "myself",
  permitted_actions: ["book", "waitlist"],
  policy_version: policy.policy_version,
  allow_monetary_charge: false,
  dry_run: false
};

const result = (outcome: "SAFE_STOP" | "TECHNICAL_FAILURE"): BookingResult =>
  outcome === "SAFE_STOP"
    ? {
        schema_version: 1,
        request_id: requestId,
        outcome,
        exit_code: 20,
        action_submitted: false,
        confirmation_verified: false,
        safety_checks: safetyChecks,
        details: "Booking stopped safely."
      }
    : {
        schema_version: 1,
        request_id: requestId,
        outcome,
        exit_code: 30,
        action_submitted: false,
        confirmation_verified: false,
        safety_checks: safetyChecks,
        details: "Runtime operation failed."
      };

const dependencies = (
  baseDir: string,
  execute: NonNullable<CliDependencies["execute"]>
): CliDependencies => ({
  baseDir,
  cwd: baseDir,
  loadPolicy: vi.fn(async () => policy),
  loadRequest: vi.fn(async () => request),
  validateRequest: vi.fn(() => request),
  execute: vi.fn(execute),
  emitResult: vi.fn(async () => undefined),
  reportDiagnostic: vi.fn()
});

const selectedResult = (exitCode: 0 | 20 | 30 | 40): BookingResult => {
  switch (exitCode) {
    case 0:
      return {
        schema_version: 1,
        request_id: requestId,
        outcome: "BOOKED",
        exit_code: 0,
        action_submitted: true,
        confirmation_verified: true,
        observed_class: observedClass,
        package_selected: "Synthetic Priority Package",
        packages_before: packagesBefore,
        safety_checks: {
          exact_class_match: true,
          approved_package_verified: true,
          no_charge: true,
          cancellation_policy_accepted: true
        },
        details: "Booking confirmed."
      };
    case 20:
      return result("SAFE_STOP");
    case 30:
      return result("TECHNICAL_FAILURE");
    case 40:
      return {
        schema_version: 1,
        request_id: requestId,
        outcome: "CONFIRMATION_UNCERTAIN",
        exit_code: 40,
        action_submitted: true,
        confirmation_verified: false,
        safety_checks: {
          exact_class_match: true,
          approved_package_verified: true,
          no_charge: true,
          cancellation_policy_accepted: true
        },
        details: "Booking confirmation is uncertain."
      };
  }
};

const executeForExitCode =
  (exitCode: 0 | 20 | 30 | 40): NonNullable<CliDependencies["execute"]> =>
  async ({ advance }) => {
    await advance("VALIDATED");
    if (exitCode === 0 || exitCode === 40) {
      await advance("READY_TO_SUBMIT");
      await advance("SUBMITTING");
    }
    if (exitCode === 0) await advance("CONFIRMED");
    return selectedResult(exitCode);
  };

const lockWithRelease = (
  release: () => Promise<LockReleaseResult>
): ProfileLock => ({ release });

describe("publishResult", () => {
  test("returns the exact request-aware bytes read after atomic replacement", async () => {
    const base = await mkdtemp(join(tmpdir(), "arketa-cli-publish-"));
    const path = join(base, "result.json");
    const selected = selectedResult(0);

    const bytes = await publishResult(path, selected, request, policy);

    expect(bytes).toBe(`${JSON.stringify(selected)}\n`);
    expect(await readFile(path, "utf8")).toBe(bytes);
    expect(bytes.endsWith("\n")).toBe(true);
    expect(bytes.endsWith("\n\n")).toBe(false);
  });

  test("preserves prior evidence and returns no bytes when atomic validation fails", async () => {
    const base = await mkdtemp(join(tmpdir(), "arketa-cli-publish-"));
    const path = join(base, "result.json");
    const priorBytes = '{"opaque":"prior evidence"}\n';
    await writeFile(path, priorBytes, "utf8");
    const contradictoryRequest = {
      ...request,
      request_id: "00000000-0000-4000-8000-000000000004"
    } as BookingRequest;

    await expect(
      publishResult(path, selectedResult(0), contradictoryRequest, policy)
    ).rejects.toThrow("JSON validation failed");
    expect(await readFile(path, "utf8")).toBe(priorBytes);
  });

  test.each([
    ["two trailing newlines", `${JSON.stringify(selectedResult(0))}\n\n`],
    [
      "different semantic result",
      `${JSON.stringify(result("TECHNICAL_FAILURE"))}\n`
    ]
  ] as const)(
    "returns no bytes when the post-rename read has %s",
    async (_case, observedBytes) => {
      const base = await mkdtemp(join(tmpdir(), "arketa-cli-publish-"));
      const path = join(base, "result.json");
      let reads = 0;
      let bytes: string | undefined;

      try {
        bytes = await publishResult(
          path,
          selectedResult(0),
          request,
          policy,
          async () => {
            reads += 1;
            return observedBytes;
          }
        );
      } catch {
        bytes = undefined;
      }

      expect(bytes).toBeUndefined();
      expect(reads).toBe(1);
      expect(await readFile(path, "utf8")).toBe(
        `${JSON.stringify(selectedResult(0))}\n`
      );
    }
  );
});

describe("runCli", () => {
  test("requires an explicit policy option and resolves its relative path from the invoking directory", async () => {
    const base = await mkdtemp(join(tmpdir(), "arketa-cli-"));
    await writeFile(join(base, "policy.json"), JSON.stringify(policy), "utf8");
    const deps = dependencies(base, async ({ advance }) => {
      await advance("VALIDATED");
      return result("SAFE_STOP");
    });
    const realPolicyDeps = { ...deps };
    delete realPolicyDeps.loadPolicy;

    await expect(runCli(cliArgs, realPolicyDeps)).resolves.toBe(20);
    expect(deps.validateRequest).toHaveBeenCalledWith(request, policy);
  });

  test("passes the exact validated policy to the executor", async () => {
    const base = await mkdtemp(join(tmpdir(), "arketa-cli-"));
    const selectedPolicy: BookingPolicy = {
      ...policy,
      allowed_packages: ["Synthetic Selected Package"]
    };
    const deps: CliDependencies = {
      ...dependencies(base, async ({ advance, policy: executedPolicy }) => {
        expect(executedPolicy).toBe(selectedPolicy);
        await advance("VALIDATED");
        return result("SAFE_STOP");
      }),
      loadPolicy: vi.fn(async () => selectedPolicy)
    };

    await expect(runCli(cliArgs, deps)).resolves.toBe(20);
  });

  test("passes the resolved persistent profile path to the executor", async () => {
    const base = await mkdtemp(join(tmpdir(), "arketa-cli-"));
    let receivedProfile = "";
    const deps = dependencies(base, async ({ advance, profileDir }) => {
      receivedProfile = profileDir;
      await advance("VALIDATED");
      return result("SAFE_STOP");
    });

    await expect(runCli(cliArgs, deps)).resolves.toBe(20);
    expect(receivedProfile).toBe(join(base, "Profile"));
  });

  test("uses the booking workflow when no executor override is supplied", async () => {
    const base = await mkdtemp(join(tmpdir(), "arketa-cli-workflow-"));
    const observedClass = {
      name: "Synthetic Reformer Flow",
      instructor: "Synthetic Instructor",
      date: "2030-01-16",
      start_time: "10:30",
      end_time: "11:20",
      timezone: "America/Los_Angeles"
    } as const;
    const workflowRequest: BookingRequest = {
      schema_version: 1,
      request_id: requestId,
      booking_url:
        "https://app.arketa.co/iframe/synthetic/calendar/checkout/workflow",
      expected_class: {
        name: observedClass.name,
        date: observedClass.date,
        start_time: observedClass.start_time,
        timezone: observedClass.timezone
      },
      reserve_for: "myself",
      permitted_actions: ["book"],
      policy_version: policy.policy_version,
      allow_monetary_charge: false,
      dry_run: true
    };
    const state: BookingPageState = {
      observation: {
        status: "observed",
        observed_class: observedClass,
        action: "book",
        packages: [
          {
            name: "Synthetic Priority Package",
            remaining: 2,
            approved: false
          }
        ]
      },
      myself: { visibleCount: 1, selected: true, enabled: true },
      injuries: { visibleCount: 1, value: "PRESENT", enabled: true },
      packages: [
        {
          row: 0,
          name: "Synthetic Priority Package",
          remaining: 2,
          active: true,
          product: false,
          control: { visibleCount: 1, selected: true, enabled: true }
        }
      ],
      selectedPackageRow: 0,
      cancellation: { visibleCount: 1, accepted: false, enabled: true },
      submission: {
        book: { visibleCount: 1, enabled: true },
        waitlist: { visibleCount: 0, enabled: false }
      },
      confirmation: { bookedVisibleCount: 0, waitlistedVisibleCount: 0 }
    };
    const page: BookingPage = {
      read: async () => state,
      selectMyself: async () => {
        throw new Error("dry run must not mutate");
      },
      fillInjuriesIfEmpty: async () => {
        throw new Error("dry run must not mutate");
      },
      selectPackage: async () => {
        throw new Error("dry run must not mutate");
      },
      acceptCancellationPolicy: async () => {
        throw new Error("dry run must not mutate");
      },
      submit: async () => {
        throw new Error("dry run must not submit");
      },
      waitForConfirmation: async () => {
        throw new Error("dry run must not wait for confirmation");
      }
    };
    const browserInputs: string[] = [];
    const bookingBrowser: BookingBrowser = async (
      profileDir,
      checkoutUrl,
      use
    ) => {
      browserInputs.push(profileDir, checkoutUrl);
      return use(page);
    };
    const deps = {
      baseDir: base,
      cwd: base,
      loadPolicy: async () => policy,
      loadRequest: async () => workflowRequest,
      validateRequest: () => workflowRequest,
      bookingBrowser,
      emitResult: vi.fn(async () => undefined),
      reportDiagnostic: vi.fn()
    };

    await expect(runCli(cliArgs, deps)).resolves.toBe(0);
    expect(browserInputs).toEqual([
      join(base, "Profile"),
      workflowRequest.booking_url
    ]);
    await expect(
      readFile(join(base, "results", evidenceName), "utf8").then(
        (value) => (JSON.parse(value) as BookingResult).outcome
      )
    ).resolves.toBe("DRY_RUN");
  });

  test("preserves an explicit absolute policy path", async () => {
    const base = await mkdtemp(join(tmpdir(), "arketa-cli-"));
    const policyPath = join(base, "private-policy.json");
    await writeFile(policyPath, JSON.stringify(policy), "utf8");
    const deps = dependencies(base, async ({ advance }) => {
      await advance("VALIDATED");
      return result("SAFE_STOP");
    });
    const realPolicyDeps = { ...deps };
    delete realPolicyDeps.loadPolicy;

    await expect(
      runCli(["--policy", policyPath, "request.json"], realPolicyDeps)
    ).resolves.toBe(20);
    expect(isAbsolute(policyPath)).toBe(true);
  });

  test("loads an absolute policy without consulting a missing working directory", async () => {
    const base = await mkdtemp(join(tmpdir(), "arketa-cli-"));
    const policyPath = join(base, "private-policy.json");
    await writeFile(policyPath, JSON.stringify(policy), "utf8");
    const deps = dependencies(base, async ({ advance }) => {
      await advance("VALIDATED");
      return result("SAFE_STOP");
    });
    const realPolicyDeps = { ...deps };
    delete realPolicyDeps.cwd;
    delete realPolicyDeps.loadPolicy;
    const cwd = vi.spyOn(process, "cwd").mockImplementation(() => {
      throw new Error("working directory is unavailable");
    });

    try {
      await expect(
        runCli(["--policy", policyPath, "request.json"], realPolicyDeps)
      ).resolves.toBe(20);
      expect(cwd).not.toHaveBeenCalled();
    } finally {
      cwd.mockRestore();
    }
  });

  test("returns technical failure when a relative policy cannot be resolved", async () => {
    const base = await mkdtemp(join(tmpdir(), "arketa-cli-"));
    const deps = dependencies(base, vi.fn());
    const relativePolicyDeps = { ...deps };
    delete relativePolicyDeps.cwd;
    const cwd = vi.spyOn(process, "cwd").mockImplementation(() => {
      throw new Error("working directory is unavailable");
    });

    try {
      await expect(runCli(cliArgs, relativePolicyDeps)).resolves.toBe(30);
      expect(deps.loadPolicy).not.toHaveBeenCalled();
      expect(deps.loadRequest).not.toHaveBeenCalled();
    } finally {
      cwd.mockRestore();
    }
  });

  test("fails before loading a request when the explicit policy cannot be loaded", async () => {
    const base = await mkdtemp(join(tmpdir(), "arketa-cli-"));
    const deps = dependencies(base, vi.fn());
    const failingPolicyPath = "synthetic-private-policy.json";
    const failingDeps: CliDependencies = {
      ...deps,
      loadPolicy: async () => {
        throw new Error(failingPolicyPath);
      }
    };

    await expect(runCli(cliArgs, failingDeps)).resolves.toBe(30);
    expect(deps.loadRequest).not.toHaveBeenCalled();
  });

  test.each([
    [],
    ["request.json"],
    ["--policy", "policy.json"],
    ["request.json", "--policy", "policy.json"],
    ["--policy", "policy.json", "request.json", "extra.json"]
  ])(
    "rejects arguments that do not explicitly select one policy: %j",
    async (...argv) => {
      const base = await mkdtemp(join(tmpdir(), "arketa-cli-"));
      const deps = dependencies(base, vi.fn());

      await expect(runCli(argv, deps)).resolves.toBe(30);
      expect(deps.loadPolicy).not.toHaveBeenCalled();
      expect(deps.loadRequest).not.toHaveBeenCalled();
    }
  );

  test.each([
    ["SAFE_STOP", 20],
    ["TECHNICAL_FAILURE", 30]
  ] as const)(
    "writes authoritative %s JSON and returns %i",
    async (outcome, code) => {
      const base = await mkdtemp(join(tmpdir(), "arketa-cli-"));
      const order: string[] = [];
      const deps = dependencies(base, async ({ advance }) => {
        order.push("execute");
        await advance("VALIDATED");
        return result(outcome);
      });
      const originalValidate = deps.validateRequest;
      const orderedDeps = {
        ...deps,
        validateRequest(value: unknown, selectedPolicy: BookingPolicy) {
          order.push("validate");
          return originalValidate(value, selectedPolicy);
        }
      };

      expect(await runCli(cliArgs, orderedDeps)).toBe(code);
      expect(
        JSON.parse(await readFile(join(base, "results", evidenceName), "utf8"))
      ).toEqual(result(outcome));
      expect(order).toEqual(["validate", "execute"]);
      await expect(access(join(base, "run.lock"))).rejects.toThrow();
    }
  );

  test.each([
    ["INITIALIZED", 30, "TECHNICAL_FAILURE"],
    ["VALIDATED", 30, "TECHNICAL_FAILURE"],
    ["READY_TO_SUBMIT", 30, "TECHNICAL_FAILURE"],
    ["SUBMITTING", 40, "CONFIRMATION_UNCERTAIN"]
  ] as const)(
    "classifies a missing result after %s as %s",
    async (state, code, outcome) => {
      const base = await mkdtemp(join(tmpdir(), "arketa-cli-"));
      const deps = dependencies(base, async ({ advance }) => {
        const states: Exclude<JournalState, "INITIALIZED">[] = [
          "VALIDATED",
          "READY_TO_SUBMIT",
          "SUBMITTING"
        ];
        for (const next of states) {
          if (state === "INITIALIZED") break;
          await advance(next);
          if (next === state) break;
        }
        throw new Error("synthetic failure with private data");
      });

      expect(await runCli(cliArgs, deps)).toBe(code);
      const written = JSON.parse(
        await readFile(join(base, "results", evidenceName), "utf8")
      ) as BookingResult;
      expect(written.outcome).toBe(outcome);
      expect(written.details).toBe(
        outcome === "CONFIRMATION_UNCERTAIN"
          ? "Booking confirmation is uncertain."
          : "Runtime operation failed."
      );
      expect(JSON.stringify(written)).not.toContain("private data");
      if (outcome === "CONFIRMATION_UNCERTAIN") {
        expect(written.safety_checks).toEqual({
          exact_class_match: true,
          approved_package_verified: true,
          no_charge: true,
          cancellation_policy_accepted: true
        });
      }
      await expect(access(join(base, "run.lock"))).rejects.toThrow();
    }
  );

  test("rejects invalid arguments before acquiring the runtime lock", async () => {
    const base = await mkdtemp(join(tmpdir(), "arketa-cli-"));
    const deps = dependencies(base, vi.fn());
    expect(await runCli([], deps)).toBe(30);
    expect(deps.loadRequest).not.toHaveBeenCalled();
    await expect(access(join(base, "run.lock"))).rejects.toThrow();
  });

  test.each(["load", "validate"] as const)(
    "returns technical failure when request %s throws",
    async (failure) => {
      const base = await mkdtemp(join(tmpdir(), "arketa-cli-"));
      const deps = dependencies(base, vi.fn());
      const failingDeps: CliDependencies = {
        ...deps,
        loadRequest:
          failure === "load"
            ? async () => {
                throw new Error("synthetic private path");
              }
            : deps.loadRequest,
        validateRequest:
          failure === "validate"
            ? () => {
                throw new Error("synthetic private value");
              }
            : deps.validateRequest
      };

      await expect(runCli(cliArgs, failingDeps)).resolves.toBe(30);
      await expect(access(join(base, "run.lock"))).rejects.toThrow();
    }
  );

  test("returns technical failure when runtime path resolution fails", async () => {
    const deps = dependencies("relative/runtime", vi.fn());
    await expect(runCli(cliArgs, deps)).resolves.toBe(30);
  });

  test("diagnoses an existing lock without executing or deleting it", async () => {
    const base = await mkdtemp(join(tmpdir(), "arketa-cli-"));
    await writeFile(join(base, "run.lock"), '{"version":1}', "utf8");
    const deps = dependencies(base, vi.fn());

    expect(await runCli(cliArgs, deps)).toBe(30);
    expect(deps.execute).not.toHaveBeenCalled();
    expect(await readFile(join(base, "run.lock"), "utf8")).toBe(
      '{"version":1}'
    );
  });

  test.each(["SUBMITTING", "CONFIRMED"] as const)(
    "classifies an existing %s journal without a result as uncertain",
    async (state) => {
      const base = await mkdtemp(join(tmpdir(), "arketa-cli-"));
      await mkdir(join(base, "journals"));
      await writeFile(
        join(base, "journals", evidenceName),
        JSON.stringify({
          schema_version: 1,
          request_id: requestId,
          state
        }),
        "utf8"
      );
      const deps = dependencies(base, vi.fn());

      expect(await runCli(cliArgs, deps)).toBe(40);
      expect(deps.execute).not.toHaveBeenCalled();
      const written = JSON.parse(
        await readFile(join(base, "results", evidenceName), "utf8")
      ) as BookingResult;
      expect(written.outcome).toBe("CONFIRMATION_UNCERTAIN");
      expect("retryable" in written).toBe(false);
      await expect(access(join(base, "run.lock"))).rejects.toThrow();
    }
  );

  test.each(["SUBMITTING", "CONFIRMED"] as const)(
    "finalizes existing %s journal uncertainty without reinterpreting a changed same-UUID request",
    async (state) => {
      const base = await mkdtemp(join(tmpdir(), "arketa-cli-"));
      await mkdir(join(base, "journals"));
      await writeFile(
        join(base, "journals", evidenceName),
        JSON.stringify({
          schema_version: 1,
          request_id: requestId,
          state
        }),
        "utf8"
      );
      const changedRequest: BookingRequest = { ...request, dry_run: true };
      const bookingBrowser = vi.fn();
      const emitted: string[] = [];
      const deps = {
        ...dependencies(base, vi.fn()),
        loadRequest: vi.fn(async () => changedRequest),
        validateRequest: vi.fn(() => changedRequest),
        bookingBrowser,
        emitResult: vi.fn(async (bytes: string) => {
          emitted.push(bytes);
        })
      };
      delete deps.execute;

      expect(await runCli(cliArgs, deps)).toBe(40);
      const resultBytes = await readFile(
        join(base, "results", evidenceName),
        "utf8"
      );
      expect(resultBytes).toBe(`${JSON.stringify(selectedResult(40))}\n`);
      expect(emitted).toEqual([resultBytes]);
      expect(bookingBrowser).not.toHaveBeenCalled();
    }
  );

  test("keeps fresh uncertainty publication request-aware for a dry-run request", async () => {
    const base = await mkdtemp(join(tmpdir(), "arketa-cli-"));
    const changedRequest: BookingRequest = { ...request, dry_run: true };
    const emitted: string[] = [];
    const deps: CliDependencies = {
      ...dependencies(base, executeForExitCode(40)),
      loadRequest: vi.fn(async () => changedRequest),
      validateRequest: vi.fn(() => changedRequest),
      emitResult: vi.fn(async (bytes: string) => {
        emitted.push(bytes);
      })
    };

    expect(await runCli(cliArgs, deps)).toBe(30);
    expect(emitted).toEqual([]);
    await expect(access(join(base, "results", evidenceName))).rejects.toThrow();
  });

  test("rejects a successful result unless the journal is confirmed", async () => {
    const base = await mkdtemp(join(tmpdir(), "arketa-cli-"));
    const deps = dependencies(base, async ({ advance }) => {
      await advance("VALIDATED");
      return {
        schema_version: 1,
        request_id: requestId,
        outcome: "BOOKED",
        exit_code: 0,
        action_submitted: true,
        confirmation_verified: true,
        observed_class: observedClass,
        package_selected: "Synthetic Priority Package",
        packages_before: packagesBefore,
        safety_checks: {
          ...safetyChecks,
          exact_class_match: true,
          approved_package_verified: true,
          no_charge: true,
          cancellation_policy_accepted: true
        },
        details: "Synthetic confirmation."
      };
    });

    expect(await runCli(cliArgs, deps)).toBe(30);
    const written = JSON.parse(
      await readFile(join(base, "results", evidenceName), "utf8")
    ) as BookingResult;
    expect(written.outcome).toBe("TECHNICAL_FAILURE");
  });

  test("publishes a confirmed successful result with exit zero", async () => {
    const base = await mkdtemp(join(tmpdir(), "arketa-cli-"));
    const deps = dependencies(base, async ({ advance }) => {
      for (const state of [
        "VALIDATED",
        "READY_TO_SUBMIT",
        "SUBMITTING",
        "CONFIRMED"
      ] as const) {
        await advance(state);
      }
      return {
        schema_version: 1,
        request_id: requestId,
        outcome: "BOOKED",
        exit_code: 0,
        action_submitted: true,
        confirmation_verified: true,
        observed_class: observedClass,
        package_selected: "Synthetic Priority Package",
        packages_before: packagesBefore,
        safety_checks: {
          exact_class_match: true,
          approved_package_verified: true,
          no_charge: true,
          cancellation_policy_accepted: true
        },
        details: "Synthetic confirmation."
      };
    });

    expect(await runCli(cliArgs, deps)).toBe(0);
    expect(
      JSON.parse(await readFile(join(base, "results", evidenceName), "utf8"))
    ).toEqual(selectedResult(0));
  });

  test.each([
    ["BOOKED", false],
    ["WAITLISTED", false],
    ["actionable DRY_RUN", true]
  ] as const)(
    "rejects custom executor %s evidence that self-approves a package absent from policy",
    async (outcome, dryRun) => {
      const base = await mkdtemp(join(tmpdir(), "arketa-cli-"));
      const arbitraryPackage = "Synthetic Arbitrary Package";
      const changedRequest: BookingRequest = { ...request, dry_run: dryRun };
      const emitted: string[] = [];
      const deps: CliDependencies = {
        ...dependencies(base, async ({ advance }) => {
          await advance("VALIDATED");
          if (outcome !== "actionable DRY_RUN") {
            await advance("READY_TO_SUBMIT");
            await advance("SUBMITTING");
            await advance("CONFIRMED");
          }
          const canonicalBooked = selectedResult(0);
          if (canonicalBooked.outcome !== "BOOKED") {
            throw new Error("invalid synthetic fixture");
          }
          const {
            google_calendar_url: ignoredCalendarUrl,
            ...canonicalEvidence
          } = canonicalBooked;
          void ignoredCalendarUrl;
          const arbitraryEvidence = {
            ...canonicalEvidence,
            package_selected: arbitraryPackage,
            packages_before: [
              { name: arbitraryPackage, remaining: 2, approved: true }
            ] as const
          };
          if (outcome === "WAITLISTED") {
            return {
              ...arbitraryEvidence,
              outcome,
              details: "Waitlist confirmed."
            };
          }
          if (outcome === "actionable DRY_RUN") {
            return {
              ...arbitraryEvidence,
              outcome: "DRY_RUN",
              action_submitted: false,
              confirmation_verified: false,
              availability: "BOOKING_AVAILABLE",
              safety_checks: {
                ...arbitraryEvidence.safety_checks,
                no_charge: false,
                cancellation_policy_accepted: false
              },
              details: "Dry run completed."
            };
          }
          return arbitraryEvidence;
        }),
        loadRequest: vi.fn(async () => changedRequest),
        validateRequest: vi.fn(() => changedRequest),
        emitResult: vi.fn(async (bytes: string) => {
          emitted.push(bytes);
        })
      };

      expect(await runCli(cliArgs, deps)).toBe(30);
      expect(emitted).toEqual([]);
      await expect(
        access(join(base, "results", evidenceName))
      ).rejects.toThrow();
    }
  );

  test("rejects an executor result that fails the canonical result schema", async () => {
    const base = await mkdtemp(join(tmpdir(), "arketa-cli-"));
    const deps = dependencies(base, async ({ advance }) => {
      await advance("VALIDATED");
      return { ...result("SAFE_STOP"), exit_code: 0 } as BookingResult;
    });

    expect(await runCli(cliArgs, deps)).toBe(30);
    const written = JSON.parse(
      await readFile(join(base, "results", evidenceName), "utf8")
    ) as BookingResult;
    expect(written.outcome).toBe("TECHNICAL_FAILURE");
  });

  test("rejects already-booked evidence that claims a submission", async () => {
    const base = await mkdtemp(join(tmpdir(), "arketa-cli-"));
    const deps = dependencies(base, async ({ advance }) => {
      await advance("VALIDATED");
      return {
        schema_version: 1,
        request_id: requestId,
        outcome: "ALREADY_BOOKED",
        exit_code: 0,
        action_submitted: true,
        confirmation_verified: true,
        safety_checks: safetyChecks,
        details: "Synthetic existing enrollment."
      } as unknown as BookingResult;
    });

    expect(await runCli(cliArgs, deps)).toBe(30);
  });

  test("rejects already-booked evidence without an exact class match", async () => {
    const base = await mkdtemp(join(tmpdir(), "arketa-cli-"));
    const deps = dependencies(base, async ({ advance }) => {
      await advance("VALIDATED");
      return {
        schema_version: 1,
        request_id: requestId,
        outcome: "ALREADY_BOOKED",
        exit_code: 0,
        action_submitted: false,
        confirmation_verified: true,
        safety_checks: safetyChecks,
        details: "Synthetic existing enrollment."
      } as unknown as BookingResult;
    });

    expect(await runCli(cliArgs, deps)).toBe(30);
  });

  test("replays matching durable bytes without opening the browser or rewriting", async () => {
    const base = await mkdtemp(join(tmpdir(), "arketa-cli-"));
    await mkdir(join(base, "journals"));
    await mkdir(join(base, "results"));
    await writeFile(
      join(base, "journals", evidenceName),
      JSON.stringify({
        schema_version: 1,
        request_id: requestId,
        state: "CONFIRMED"
      }),
      "utf8"
    );
    const durableResult = {
      schema_version: 1,
      request_id: requestId,
      outcome: "BOOKED",
      exit_code: 0,
      action_submitted: true,
      confirmation_verified: true,
      observed_class: observedClass,
      package_selected: "Synthetic Priority Package",
      packages_before: packagesBefore,
      safety_checks: {
        exact_class_match: true,
        approved_package_verified: true,
        no_charge: true,
        cancellation_policy_accepted: true
      },
      details: "Booking confirmed."
    } as const;
    const serialized = ` { "details": "Booking confirmed.", "safety_checks": ${JSON.stringify(durableResult.safety_checks)}, "packages_before": ${JSON.stringify(packagesBefore)}, "package_selected": "Synthetic Priority Package", "observed_class": ${JSON.stringify(observedClass)}, "confirmation_verified": true, "action_submitted": true, "exit_code": 0, "outcome": "BOOKED", "request_id": "${requestId}", "schema_version": 1 }\n`;
    await writeFile(join(base, "results", evidenceName), serialized, "utf8");
    const bookingBrowser = vi.fn();
    const deps = { ...dependencies(base, vi.fn()), bookingBrowser };
    delete deps.execute;

    expect(await runCli(cliArgs, deps)).toBe(0);
    expect(await readFile(join(base, "results", evidenceName), "utf8")).toBe(
      serialized
    );
    expect(bookingBrowser).not.toHaveBeenCalled();
  });

  test.each([
    ["dry-run mode", { dry_run: true }],
    [
      "expected class",
      {
        expected_class: {
          ...request.expected_class,
          name: "Synthetic Later Class"
        }
      }
    ]
  ] as const)(
    "replays original finalized bytes when a same-UUID request changes its %s",
    async (_changedField, requestChanges) => {
      const base = await mkdtemp(join(tmpdir(), "arketa-cli-"));
      await mkdir(join(base, "journals"));
      await mkdir(join(base, "results"));
      await writeFile(
        join(base, "journals", evidenceName),
        JSON.stringify({
          schema_version: 1,
          request_id: requestId,
          state: "CONFIRMED"
        }),
        "utf8"
      );
      const replayBytes = ` ${JSON.stringify(selectedResult(0))}\n`;
      const resultPath = join(base, "results", evidenceName);
      await writeFile(resultPath, replayBytes, "utf8");
      const changedRequest: BookingRequest = {
        ...request,
        ...requestChanges
      };
      const bookingBrowser = vi.fn();
      const emitted: string[] = [];
      const deps = {
        ...dependencies(base, vi.fn()),
        loadRequest: vi.fn(async () => changedRequest),
        validateRequest: vi.fn(() => changedRequest),
        bookingBrowser,
        emitResult: vi.fn(async (bytes: string) => {
          emitted.push(bytes);
        })
      };
      delete deps.execute;

      expect(await runCli(cliArgs, deps)).toBe(0);
      expect(emitted).toEqual([replayBytes]);
      expect(await readFile(resultPath, "utf8")).toBe(replayBytes);
      expect(bookingBrowser).not.toHaveBeenCalled();
    }
  );

  test("does not overwrite artifacts belonging to another request", async () => {
    const base = await mkdtemp(join(tmpdir(), "arketa-cli-"));
    await mkdir(join(base, "journals"));
    await mkdir(join(base, "results"));
    const otherRequestId = "00000000-0000-4000-8000-000000000004";
    const journal = JSON.stringify({
      schema_version: 1,
      request_id: otherRequestId,
      state: "SUBMITTING"
    });
    const priorResult = '{"opaque":"prior-authoritative-result"}';
    await writeFile(join(base, "journals", evidenceName), journal, "utf8");
    await writeFile(join(base, "results", evidenceName), priorResult, "utf8");
    const deps = dependencies(base, vi.fn());

    expect(await runCli(cliArgs, deps)).toBe(30);
    expect(await readFile(join(base, "journals", evidenceName), "utf8")).toBe(
      journal
    );
    expect(await readFile(join(base, "results", evidenceName), "utf8")).toBe(
      priorResult
    );
  });

  test.each(["malformed", "unreadable"] as const)(
    "preserves existing result bytes when the journal is %s",
    async (journalFailure) => {
      const base = await mkdtemp(join(tmpdir(), "arketa-cli-"));
      await mkdir(join(base, "journals"));
      await mkdir(join(base, "results"));
      const journalPath = join(base, "journals", evidenceName);
      if (journalFailure === "malformed") {
        await writeFile(journalPath, '{"request_id":', "utf8");
      } else {
        await mkdir(journalPath);
      }
      const priorResult =
        '{"opaque":"existing result evidence must remain byte-for-byte"}\n';
      const resultPath = join(base, "results", evidenceName);
      await writeFile(resultPath, priorResult, "utf8");
      const deps = dependencies(base, vi.fn());

      await expect(runCli(cliArgs, deps)).resolves.toBe(30);
      expect(await readFile(resultPath, "utf8")).toBe(priorResult);
      expect(deps.execute).not.toHaveBeenCalled();
    }
  );

  test("preserves a schema-invalid result owned by another request byte-for-byte", async () => {
    const base = await mkdtemp(join(tmpdir(), "arketa-cli-"));
    await mkdir(join(base, "journals"));
    await mkdir(join(base, "results"));
    await writeFile(
      join(base, "journals", evidenceName),
      JSON.stringify({
        schema_version: 1,
        request_id: requestId,
        state: "VALIDATED"
      }),
      "utf8"
    );
    const foreignInvalidResult = `${JSON.stringify({
      ...result("TECHNICAL_FAILURE"),
      request_id: "00000000-0000-4000-8000-000000000004",
      unexpected_private_field: "must not be reserialized"
    })}\n`;
    const resultPath = join(base, "results", evidenceName);
    await writeFile(resultPath, foreignInvalidResult, "utf8");
    const deps = dependencies(base, vi.fn());

    await expect(runCli(cliArgs, deps)).resolves.toBe(30);
    expect(await readFile(resultPath, "utf8")).toBe(foreignInvalidResult);
    expect(deps.execute).not.toHaveBeenCalled();
  });

  test.each([
    ["VALIDATED", "TECHNICAL_FAILURE", 30, "Runtime operation failed."],
    [
      "SUBMITTING",
      "CONFIRMATION_UNCERTAIN",
      30,
      "Booking confirmation is uncertain."
    ]
  ] as const)(
    "preserves a schema-invalid same-request result using %s state safety",
    async (state, outcome, exitCode, details) => {
      const base = await mkdtemp(join(tmpdir(), "arketa-cli-"));
      await mkdir(join(base, "journals"));
      await mkdir(join(base, "results"));
      await writeFile(
        join(base, "journals", evidenceName),
        JSON.stringify({
          schema_version: 1,
          request_id: requestId,
          state
        }),
        "utf8"
      );
      const priorBytes = JSON.stringify({
        ...result("TECHNICAL_FAILURE"),
        unexpected_private_field: "must remain byte-for-byte"
      });
      const resultPath = join(base, "results", evidenceName);
      await writeFile(resultPath, priorBytes, "utf8");

      await expect(runCli(cliArgs, dependencies(base, vi.fn()))).resolves.toBe(
        exitCode
      );
      expect(outcome).toBe(
        state === "SUBMITTING" ? "CONFIRMATION_UNCERTAIN" : "TECHNICAL_FAILURE"
      );
      expect(details).toBe(
        state === "SUBMITTING"
          ? "Booking confirmation is uncertain."
          : "Runtime operation failed."
      );
      expect(await readFile(resultPath, "utf8")).toBe(priorBytes);
    }
  );

  test("preserves a valid recovered uncertainty result for a confirmed journal", async () => {
    const base = await mkdtemp(join(tmpdir(), "arketa-cli-"));
    await mkdir(join(base, "journals"));
    await mkdir(join(base, "results"));
    await writeFile(
      join(base, "journals", evidenceName),
      JSON.stringify({
        schema_version: 1,
        request_id: requestId,
        state: "CONFIRMED"
      }),
      "utf8"
    );
    const recovered = {
      schema_version: 1,
      request_id: requestId,
      outcome: "CONFIRMATION_UNCERTAIN",
      exit_code: 40,
      action_submitted: true,
      confirmation_verified: false,
      safety_checks: {
        exact_class_match: true,
        approved_package_verified: true,
        no_charge: true,
        cancellation_policy_accepted: true
      },
      details: "Booking confirmation is uncertain."
    } as const;
    const serialized = JSON.stringify(recovered);
    await writeFile(join(base, "results", evidenceName), serialized, "utf8");

    expect(await runCli(cliArgs, dependencies(base, vi.fn()))).toBe(40);
    expect(await readFile(join(base, "results", evidenceName), "utf8")).toBe(
      serialized
    );
  });

  test("preserves contradictory recovered details byte-for-byte", async () => {
    const base = await mkdtemp(join(tmpdir(), "arketa-cli-"));
    await mkdir(join(base, "journals"));
    await mkdir(join(base, "results"));
    await writeFile(
      join(base, "journals", evidenceName),
      JSON.stringify({
        schema_version: 1,
        request_id: requestId,
        state: "CONFIRMED"
      }),
      "utf8"
    );
    const recovered = {
      ...selectedResult(0),
      details: "synthetic /private/runtime/session-token"
    } as const;
    const priorBytes = `${JSON.stringify(recovered)}\n`;
    const resultPath = join(base, "results", evidenceName);
    await writeFile(resultPath, priorBytes, "utf8");
    const deps = dependencies(base, vi.fn());

    await expect(runCli(cliArgs, deps)).resolves.toBe(30);
    expect(await readFile(resultPath, "utf8")).toBe(priorBytes);
    expect(deps.execute).not.toHaveBeenCalled();
  });

  test("preserves internally incoherent recovered package evidence byte-for-byte", async () => {
    const base = await mkdtemp(join(tmpdir(), "arketa-cli-"));
    await mkdir(join(base, "journals"));
    await mkdir(join(base, "results"));
    await writeFile(
      join(base, "journals", evidenceName),
      JSON.stringify({
        schema_version: 1,
        request_id: requestId,
        state: "CONFIRMED"
      }),
      "utf8"
    );
    const incoherent = {
      ...selectedResult(0),
      package_selected: "Synthetic Other Package"
    };
    const priorBytes = `${JSON.stringify(incoherent)}\n`;
    const resultPath = join(base, "results", evidenceName);
    await writeFile(resultPath, priorBytes, "utf8");
    const deps = dependencies(base, vi.fn());

    await expect(runCli(cliArgs, deps)).resolves.toBe(30);
    expect(await readFile(resultPath, "utf8")).toBe(priorBytes);
    expect(deps.execute).not.toHaveBeenCalled();
  });

  test.each([
    ["raw", "synthetic /private/runtime/session-token"],
    ["escaped", "synthetic private\nsecond-line session-token"],
    ["encoded", "synthetic%20%2Fprivate%2Fruntime%2Fsession-token"],
    [
      "repeatedly encoded",
      "synthetic%2520%252Fprivate%252Fruntime%252Fsession-token"
    ]
  ] as const)(
    "replaces %s executor diagnostic input with a fixed marker",
    async (_representation, unsafeDetails) => {
      const base = await mkdtemp(join(tmpdir(), "arketa-cli-"));
      const deps = dependencies(base, async ({ advance }) => {
        for (const state of [
          "VALIDATED",
          "READY_TO_SUBMIT",
          "SUBMITTING",
          "CONFIRMED"
        ] as const) {
          await advance(state);
        }
        return {
          ...selectedResult(0),
          details: unsafeDetails
        };
      });

      await expect(runCli(cliArgs, deps)).resolves.toBe(0);
      const written = JSON.parse(
        await readFile(join(base, "results", evidenceName), "utf8")
      ) as BookingResult;
      expect(written.details).toBe("Booking confirmed.");
      expect(JSON.stringify(written)).not.toContain(unsafeDetails);
    }
  );

  test("preserves a valid result belonging to another request", async () => {
    const base = await mkdtemp(join(tmpdir(), "arketa-cli-"));
    await mkdir(join(base, "journals"));
    await mkdir(join(base, "results"));
    await writeFile(
      join(base, "journals", evidenceName),
      JSON.stringify({
        schema_version: 1,
        request_id: requestId,
        state: "VALIDATED"
      }),
      "utf8"
    );
    const otherResult = JSON.stringify({
      ...result("TECHNICAL_FAILURE"),
      request_id: "00000000-0000-4000-8000-000000000004"
    });
    await writeFile(join(base, "results", evidenceName), otherResult, "utf8");

    expect(await runCli(cliArgs, dependencies(base, vi.fn()))).toBe(30);
    expect(await readFile(join(base, "results", evidenceName), "utf8")).toBe(
      otherResult
    );
  });

  test("returns transport failure when recovered result I/O fails after submission", async () => {
    const base = await mkdtemp(join(tmpdir(), "arketa-cli-"));
    await mkdir(join(base, "journals"));
    await mkdir(join(base, "results", evidenceName), { recursive: true });
    await writeFile(
      join(base, "journals", evidenceName),
      JSON.stringify({
        schema_version: 1,
        request_id: requestId,
        state: "SUBMITTING"
      }),
      "utf8"
    );

    await expect(runCli(cliArgs, dependencies(base, vi.fn()))).resolves.toBe(
      30
    );
  });

  test("returns transport failure without rereading the journal when result publication fails after submission", async () => {
    const base = await mkdtemp(join(tmpdir(), "arketa-cli-"));
    const deps = dependencies(base, async ({ advance }) => {
      await advance("VALIDATED");
      await advance("READY_TO_SUBMIT");
      await advance("SUBMITTING");
      await mkdir(join(base, "results", evidenceName), { recursive: true });
      await writeFile(
        join(base, "journals", evidenceName),
        "{synthetic malformed journal",
        "utf8"
      );
      throw new Error("synthetic post-submit failure");
    });

    await expect(runCli(cliArgs, deps)).resolves.toBe(30);
  });

  test.each([
    [0, "close"],
    [0, "stat"],
    [0, "unlink"],
    [20, "close"],
    [20, "stat"],
    [20, "unlink"],
    [30, "close"],
    [30, "stat"],
    [30, "unlink"],
    [40, "close"],
    [40, "stat"],
    [40, "unlink"]
  ] as const)(
    "preserves selected exit %i when lock release returns the %s failure stage",
    async (exitCode, stage) => {
      const base = await mkdtemp(join(tmpdir(), "arketa-cli-"));
      let releaseAttempts = 0;
      const deps: CliDependencies = {
        ...dependencies(base, executeForExitCode(exitCode)),
        acquireLock: async () =>
          lockWithRelease(async () => {
            releaseAttempts += 1;
            return { released: false, stage };
          })
      };

      await expect(runCli(cliArgs, deps)).resolves.toBe(exitCode);
      expect(releaseAttempts).toBe(1);
    }
  );

  test.each([0, 20, 30, 40] as const)(
    "preserves selected exit %i when lock release unexpectedly throws",
    async (exitCode) => {
      const base = await mkdtemp(join(tmpdir(), "arketa-cli-"));
      const privateMessage = "synthetic private cleanup path";
      let releaseAttempts = 0;
      const deps: CliDependencies = {
        ...dependencies(base, executeForExitCode(exitCode)),
        acquireLock: async () =>
          lockWithRelease(async () => {
            releaseAttempts += 1;
            throw new Error(privateMessage);
          })
      };

      await expect(runCli(cliArgs, deps)).resolves.toBe(exitCode);
      expect(releaseAttempts).toBe(1);
      expect(
        await readFile(join(base, "results", evidenceName), "utf8")
      ).not.toContain(privateMessage);
    }
  );

  test.each([0, 20, 30, 40] as const)(
    "emits finalized exit %i bytes once after releasing the lock",
    async (exitCode) => {
      const base = await mkdtemp(join(tmpdir(), "arketa-cli-output-"));
      const events: string[] = [];
      const emitted: string[] = [];
      const diagnostics: CliDiagnostic[] = [];
      const deps: CliDependencies = {
        ...dependencies(base, executeForExitCode(exitCode)),
        acquireLock: async () =>
          lockWithRelease(async () => {
            events.push("release");
            return { released: true };
          }),
        emitResult: async (bytes) => {
          events.push("emit");
          emitted.push(bytes);
        },
        reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic)
      };

      expect(await runCli(cliArgs, deps)).toBe(exitCode);
      const durable = await readFile(
        join(base, "results", evidenceName),
        "utf8"
      );
      expect(emitted).toEqual([durable]);
      expect(events).toEqual(["release", "emit"]);
      expect(diagnostics).toEqual([]);
    }
  );

  test("reports early invalid input once without emitting stdout", async () => {
    const base = await mkdtemp(join(tmpdir(), "arketa-cli-output-"));
    const emitted: string[] = [];
    const diagnostics: CliDiagnostic[] = [];
    const deps: CliDependencies = {
      ...dependencies(base, vi.fn()),
      emitResult: async (bytes) => {
        emitted.push(bytes);
      },
      reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic)
    };

    expect(await runCli([], deps)).toBe(30);
    expect(emitted).toEqual([]);
    expect(diagnostics).toEqual([CLI_FAILURE_DIAGNOSTIC]);
  });

  test("reports reconciliation failure once without emitting stdout", async () => {
    const base = await mkdtemp(join(tmpdir(), "arketa-cli-output-"));
    await mkdir(join(base, "results"));
    const priorBytes = `${JSON.stringify(selectedResult(0))}\n`;
    await writeFile(join(base, "results", evidenceName), priorBytes, "utf8");
    const emitted: string[] = [];
    const diagnostics: CliDiagnostic[] = [];
    const deps: CliDependencies = {
      ...dependencies(base, vi.fn()),
      emitResult: async (bytes) => {
        emitted.push(bytes);
      },
      reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic)
    };

    expect(await runCli(cliArgs, deps)).toBe(30);
    expect(emitted).toEqual([]);
    expect(diagnostics).toEqual([CLI_FAILURE_DIAGNOSTIC]);
    expect(await readFile(join(base, "results", evidenceName), "utf8")).toBe(
      priorBytes
    );
    expect(deps.execute).not.toHaveBeenCalled();
  });

  test("reports finalization failure once without emitting stdout", async () => {
    const base = await mkdtemp(join(tmpdir(), "arketa-cli-output-"));
    const emitted: string[] = [];
    const diagnostics: CliDiagnostic[] = [];
    const deps: CliDependencies = {
      ...dependencies(base, async ({ advance }) => {
        await advance("VALIDATED");
        await mkdir(join(base, "results", evidenceName), { recursive: true });
        return result("SAFE_STOP");
      }),
      emitResult: async (bytes) => {
        emitted.push(bytes);
      },
      reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic)
    };

    expect(await runCli(cliArgs, deps)).toBe(30);
    expect(emitted).toEqual([]);
    expect(diagnostics).toEqual([CLI_FAILURE_DIAGNOSTIC]);
  });

  test("preserves finalized evidence when stdout emission fails", async () => {
    const base = await mkdtemp(join(tmpdir(), "arketa-cli-output-"));
    const diagnostics: CliDiagnostic[] = [];
    const deps: CliDependencies = {
      ...dependencies(base, executeForExitCode(0)),
      emitResult: async () => {
        throw new Error("synthetic private stdout failure");
      },
      reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic)
    };

    expect(await runCli(cliArgs, deps)).toBe(30);
    expect(await readFile(join(base, "results", evidenceName), "utf8")).toBe(
      `${JSON.stringify(selectedResult(0))}\n`
    );
    expect(diagnostics).toEqual([CLI_FAILURE_DIAGNOSTIC]);
  });

  test("emits exact coherent replay bytes without opening the browser", async () => {
    const base = await mkdtemp(join(tmpdir(), "arketa-cli-output-"));
    await mkdir(join(base, "journals"));
    await mkdir(join(base, "results"));
    await writeFile(
      join(base, "journals", evidenceName),
      JSON.stringify({
        schema_version: 1,
        request_id: requestId,
        state: "CONFIRMED"
      }),
      "utf8"
    );
    const replayBytes = ` { "details": "Booking confirmed.", "safety_checks": ${JSON.stringify(selectedResult(0).safety_checks)}, "packages_before": ${JSON.stringify(packagesBefore)}, "package_selected": "Synthetic Priority Package", "observed_class": ${JSON.stringify(observedClass)}, "confirmation_verified": true, "action_submitted": true, "exit_code": 0, "outcome": "BOOKED", "request_id": "${requestId}", "schema_version": 1 }\n`;
    await writeFile(join(base, "results", evidenceName), replayBytes, "utf8");
    const bookingBrowser = vi.fn();
    const emitted: string[] = [];
    const deps = {
      ...dependencies(base, vi.fn()),
      bookingBrowser,
      emitResult: async (bytes: string) => {
        emitted.push(bytes);
      }
    };
    delete deps.execute;

    expect(await runCli(cliArgs, deps)).toBe(0);
    expect(emitted).toEqual([replayBytes]);
    expect(bookingBrowser).not.toHaveBeenCalled();
  });
});
