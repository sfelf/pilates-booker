import { describe, expect, test } from "vitest";

import type {
  BookingRequest,
  BookingResult,
  JournalRecord,
  JournalState
} from "../src/contracts.js";
import {
  classifyFailure,
  isPostSubmission,
  resultMatchesDurableState,
  RuntimeCoordinator,
  type ResultReadStatus,
  type RuntimeOperations
} from "../src/runtime-coordinator.js";

const requestId = "00000000-0000-4000-8000-000000000003";

const noSubmissionSafetyChecks = {
  exact_class_match: false,
  approved_package_verified: false,
  no_charge: false,
  cancellation_policy_accepted: false
} as const;

const submittedSafetyChecks = {
  exact_class_match: true,
  approved_package_verified: true,
  no_charge: true,
  cancellation_policy_accepted: true
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

const technicalFailure = {
  schema_version: 1,
  request_id: requestId,
  outcome: "TECHNICAL_FAILURE",
  exit_code: 30,
  action_submitted: false,
  confirmation_verified: false,
  safety_checks: noSubmissionSafetyChecks,
  details: "Runtime operation failed."
} as const satisfies BookingResult;

const alreadyBookedExact = {
  schema_version: 1,
  request_id: requestId,
  outcome: "ALREADY_BOOKED",
  exit_code: 0,
  action_submitted: false,
  confirmation_verified: true,
  observed_class: observedClass,
  safety_checks: {
    ...noSubmissionSafetyChecks,
    exact_class_match: true
  },
  details: "Existing booking confirmed."
} as const satisfies BookingResult;

const alreadyBookedWrongClass = {
  ...alreadyBookedExact,
  safety_checks: noSubmissionSafetyChecks
} as unknown as BookingResult;

const actionableDryRun = {
  schema_version: 1,
  request_id: requestId,
  outcome: "DRY_RUN",
  exit_code: 0,
  action_submitted: false,
  confirmation_verified: false,
  availability: "BOOKING_AVAILABLE",
  observed_class: {
    name: "Synthetic Reformer Flow",
    instructor: "Synthetic Instructor",
    date: "2030-01-16",
    start_time: "10:30",
    end_time: "11:30",
    timezone: "America/Los_Angeles"
  },
  package_selected: "⭐ Synthetic Priority Package",
  packages_before: [
    { name: "Synthetic Backup Package", remaining: 4, approved: false },
    { name: "Synthetic Priority Package ★", remaining: 2, approved: true }
  ],
  safety_checks: {
    exact_class_match: true,
    approved_package_verified: true,
    no_charge: false,
    cancellation_policy_accepted: false
  },
  details: "Dry run completed."
} as const satisfies BookingResult;

const existingEnrollmentDryRun = {
  schema_version: 1,
  request_id: requestId,
  outcome: "DRY_RUN",
  exit_code: 0,
  action_submitted: false,
  confirmation_verified: true,
  availability: "ALREADY_BOOKED",
  observed_class: actionableDryRun.observed_class,
  google_calendar_url: "https://calendar.example.test/event/synthetic",
  safety_checks: {
    exact_class_match: true,
    approved_package_verified: false,
    no_charge: false,
    cancellation_policy_accepted: false
  },
  details: "Dry run completed."
} as const satisfies BookingResult;

const safeStop = {
  ...technicalFailure,
  outcome: "SAFE_STOP",
  exit_code: 20,
  details: "Booking stopped safely."
} as const satisfies BookingResult;

const confirmationUncertain = {
  schema_version: 1,
  request_id: requestId,
  outcome: "CONFIRMATION_UNCERTAIN",
  exit_code: 40,
  action_submitted: true,
  confirmation_verified: false,
  safety_checks: submittedSafetyChecks,
  details: "Booking confirmation is uncertain."
} as const satisfies BookingResult;

const booked = {
  schema_version: 1,
  request_id: requestId,
  outcome: "BOOKED",
  exit_code: 0,
  action_submitted: true,
  confirmation_verified: true,
  observed_class: observedClass,
  package_selected: "Synthetic Priority Package",
  packages_before: packagesBefore,
  safety_checks: submittedSafetyChecks,
  details: "Booking confirmed."
} as const satisfies BookingResult;

const request = {
  schema_version: 1,
  request_id: requestId,
  booking_url: "https://book.arketa.example/classes/expected",
  expected_class: {
    name: "Expected class",
    date: "2026-08-21",
    start_time: "09:00",
    timezone: "America/Los_Angeles"
  },
  reserve_for: "myself",
  permitted_actions: ["book", "waitlist"],
  policy_version: "2026-08-21",
  allow_monetary_charge: false,
  dry_run: false
} as const satisfies BookingRequest;

class InMemoryRuntimeOperations implements RuntimeOperations {
  journal: JournalRecord | undefined;
  result: BookingResult | undefined;
  resultStatus: ResultReadStatus | undefined;
  failWriteAt: JournalState | undefined;
  failReadJournal = false;
  failReadResult = false;
  failReadJournalAfterSubmission = false;
  failWriteResult = false;

  async readJournal(): Promise<JournalRecord | undefined> {
    if (
      this.failReadJournal ||
      (this.failReadJournalAfterSubmission &&
        (this.journal?.state === "SUBMITTING" ||
          this.journal?.state === "CONFIRMED"))
    ) {
      throw new Error("journal read failed");
    }
    return this.journal;
  }

  async writeJournal(record: JournalRecord): Promise<void> {
    if (record.state === this.failWriteAt)
      throw new Error("journal write failed");
    this.journal = record;
  }

  async readResult(): Promise<ResultReadStatus> {
    if (this.failReadResult) return { status: "failure" };
    if (this.resultStatus !== undefined) return this.resultStatus;
    return this.result === undefined
      ? { status: "missing" }
      : { status: "valid", result: this.result };
  }

  async writeResult(result: BookingResult): Promise<void> {
    if (this.failWriteResult) throw new Error("result write failed");
    this.result = result;
  }
}

describe("resultMatchesDurableState", () => {
  test.each([
    ["INITIALIZED", technicalFailure, true],
    ["VALIDATED", alreadyBookedExact, true],
    ["VALIDATED", alreadyBookedWrongClass, false],
    ["VALIDATED", actionableDryRun, true],
    ["VALIDATED", existingEnrollmentDryRun, true],
    ["READY_TO_SUBMIT", safeStop, true],
    ["SUBMITTING", confirmationUncertain, true],
    ["SUBMITTING", technicalFailure, false],
    ["CONFIRMED", booked, true],
    ["CONFIRMED", confirmationUncertain, true]
  ] as const)("checks %s result evidence", (state, result, expected) => {
    expect(resultMatchesDurableState(result, state, requestId)).toBe(expected);
  });

  test.each([
    [
      "rejects a result for another request",
      {
        ...technicalFailure,
        request_id: "00000000-0000-4000-8000-000000000004"
      },
      "INITIALIZED"
    ],
    [
      "rejects success without authoritative confirmation",
      { ...booked, confirmation_verified: false },
      "CONFIRMED"
    ],
    [
      "rejects already-enrolled evidence with a submission",
      { ...alreadyBookedExact, action_submitted: true, submission_attempts: 1 },
      "VALIDATED"
    ],
    [
      "rejects actionable dry-run evidence with a submission",
      { ...actionableDryRun, action_submitted: true },
      "VALIDATED"
    ],
    [
      "rejects dry-run evidence with an unknown availability",
      { ...existingEnrollmentDryRun, availability: "UNKNOWN" },
      "VALIDATED"
    ],
    [
      "rejects actionable dry-run evidence without an observed class",
      { ...actionableDryRun, observed_class: undefined },
      "VALIDATED"
    ],
    [
      "rejects existing-enrollment dry-run evidence without an observed class",
      { ...existingEnrollmentDryRun, observed_class: undefined },
      "VALIDATED"
    ],
    [
      "rejects actionable dry-run evidence with an empty package list",
      { ...actionableDryRun, packages_before: [] },
      "VALIDATED"
    ],
    [
      "rejects actionable dry-run evidence without a positive approved package",
      {
        ...actionableDryRun,
        packages_before: [
          {
            name: "Synthetic Priority Package ★",
            remaining: 0,
            approved: true
          }
        ]
      },
      "VALIDATED"
    ],
    [
      "rejects actionable dry-run evidence with a fractional package balance",
      {
        ...actionableDryRun,
        packages_before: [
          {
            name: "Synthetic Priority Package ★",
            remaining: 0.5,
            approved: true
          }
        ]
      },
      "VALIDATED"
    ],
    [
      "rejects actionable dry-run evidence with an unsafe integer package balance",
      {
        ...actionableDryRun,
        packages_before: [
          {
            name: "Synthetic Priority Package ★",
            remaining: Number.MAX_SAFE_INTEGER + 1,
            approved: true
          }
        ]
      },
      "VALIDATED"
    ],
    [
      "rejects actionable dry-run evidence for a different configured package",
      {
        ...actionableDryRun,
        packages_before: [
          {
            name: "Synthetic Other Package",
            remaining: 2,
            approved: true
          }
        ]
      },
      "VALIDATED"
    ],
    [
      "rejects retryable confirmation uncertainty",
      { ...confirmationUncertain, retryable: true },
      "SUBMITTING"
    ],
    [
      "rejects confirmation uncertainty without a submitted action",
      { ...confirmationUncertain, action_submitted: false },
      "SUBMITTING"
    ],
    [
      "rejects confirmation uncertainty with more than one attempt",
      { ...confirmationUncertain, submission_attempts: 2 },
      "SUBMITTING"
    ],
    [
      "rejects uncertainty without every pre-submission safety check",
      {
        ...confirmationUncertain,
        safety_checks: { ...submittedSafetyChecks, no_charge: false }
      },
      "SUBMITTING"
    ],
    [
      "rejects non-canonical diagnostic details",
      { ...booked, details: "synthetic private session text" },
      "CONFIRMED"
    ]
  ] as const)("%s", (_description, result, state) => {
    expect(
      resultMatchesDurableState(result as BookingResult, state, requestId)
    ).toBe(false);
  });
});

describe("classifyFailure", () => {
  test.each([
    [undefined, "TECHNICAL_FAILURE", 30],
    ["READY_TO_SUBMIT", "TECHNICAL_FAILURE", 30],
    ["SUBMITTING", "CONFIRMATION_UNCERTAIN", 40],
    ["CONFIRMED", "CONFIRMATION_UNCERTAIN", 40]
  ] as const)("classifies %s as %s", (state, outcome, exitCode) => {
    const result = classifyFailure(requestId, state);

    expect(result.outcome).toBe(outcome);
    expect(result.exit_code).toBe(exitCode);
    expect(result.request_id).toBe(requestId);
    expect(result.details).toBe(
      state === "SUBMITTING" || state === "CONFIRMED"
        ? "Booking confirmation is uncertain."
        : "Runtime operation failed."
    );
  });
});

test.each([
  [undefined, false],
  ["INITIALIZED", false],
  ["VALIDATED", false],
  ["READY_TO_SUBMIT", false],
  ["SUBMITTING", true],
  ["CONFIRMED", true]
] as const)("identifies whether %s is post-submission", (state, expected) => {
  expect(isPostSubmission(state)).toBe(expected);
});

describe("RuntimeCoordinator durable state", () => {
  test("retains the last successfully persisted journal state", async () => {
    const operations = new InMemoryRuntimeOperations();
    const coordinator = new RuntimeCoordinator(request, operations);

    await coordinator.initialize();
    await coordinator.advance("VALIDATED");
    await coordinator.advance("READY_TO_SUBMIT");
    expect(coordinator.lastDurableState).toBe("READY_TO_SUBMIT");

    operations.failWriteAt = "SUBMITTING";
    await expect(coordinator.advance("SUBMITTING")).rejects.toThrow(
      "journal write failed"
    );
    expect(coordinator.lastDurableState).toBe("READY_TO_SUBMIT");
  });

  test("does not reread a durable state after it has advanced", async () => {
    const operations = new InMemoryRuntimeOperations();
    const coordinator = new RuntimeCoordinator(request, operations);

    await coordinator.initialize();
    await coordinator.advance("VALIDATED");
    await coordinator.advance("READY_TO_SUBMIT");
    await coordinator.advance("SUBMITTING");
    operations.failReadJournal = true;

    expect(coordinator.lastDurableState).toBe("SUBMITTING");
  });

  test("rejects out-of-sequence state changes at the coordinator boundary", async () => {
    const operations = new InMemoryRuntimeOperations();
    const coordinator = new RuntimeCoordinator(request, operations);

    await expect(coordinator.advance("VALIDATED")).rejects.toThrow(
      "invalid journal transition"
    );
    await coordinator.initialize();
    await expect(coordinator.advance("SUBMITTING")).rejects.toThrow(
      "invalid journal transition"
    );
    await expect(coordinator.initialize()).rejects.toThrow(
      "invalid journal transition"
    );
    expect(coordinator.lastDurableState).toBe("INITIALIZED");
  });
});

describe("RuntimeCoordinator execution", () => {
  test("retains the validated request ID when an executor mutates its alias", async () => {
    const operations = new InMemoryRuntimeOperations();
    const originalRequest = { ...request } as BookingRequest;
    const coordinator = new RuntimeCoordinator(originalRequest, operations);

    const decision = await coordinator.run(
      async ({ request: executorRequest, advance }) => {
        await advance("VALIDATED");
        (
          executorRequest as unknown as {
            request_id: string;
          }
        ).request_id = "00000000-0000-4000-8000-000000000099";
        return technicalFailure;
      }
    );

    expect(operations.journal?.request_id).toBe(requestId);
    expect(decision.result.request_id).toBe(requestId);
  });

  async function runFaultCase(state: JournalState, invalidResult = false) {
    const operations = new InMemoryRuntimeOperations();
    operations.failReadJournalAfterSubmission = true;
    const coordinator = new RuntimeCoordinator(request, operations);

    return coordinator.run(async ({ advance }) => {
      for (const next of [
        "VALIDATED",
        "READY_TO_SUBMIT",
        "SUBMITTING",
        "CONFIRMED"
      ] as const) {
        if (state === "INITIALIZED") break;
        await advance(next);
        if (next === state) break;
      }

      if (invalidResult) {
        return {
          ...confirmationUncertain,
          exit_code: 30
        } as unknown as BookingResult;
      }
      throw new Error("synthetic executor failure");
    });
  }

  test.each([
    ["executor throws after INITIALIZED", "INITIALIZED", 30, false],
    ["executor throws after VALIDATED", "VALIDATED", 30, false],
    ["executor throws after READY_TO_SUBMIT", "READY_TO_SUBMIT", 30, false],
    ["executor throws after SUBMITTING", "SUBMITTING", 40, false],
    ["executor throws after CONFIRMED", "CONFIRMED", 40, false],
    ["executor returns invalid result after SUBMITTING", "SUBMITTING", 40, true]
  ] as const)(
    "classifies %s",
    async (_failurePhase, state, exitCode, invalidResult) => {
      const decision = await runFaultCase(state, invalidResult);

      expect(decision.result.exit_code).toBe(exitCode);
    }
  );

  test("invokes a failing executor only once", async () => {
    const coordinator = new RuntimeCoordinator(
      request,
      new InMemoryRuntimeOperations()
    );
    let executions = 0;

    const decision = await coordinator.run(async () => {
      executions += 1;
      throw new Error("synthetic executor failure");
    });

    expect(executions).toBe(1);
    expect(decision.result.exit_code).toBe(30);
  });

  test.each([
    [
      "BOOKED",
      booked,
      ["VALIDATED", "READY_TO_SUBMIT", "SUBMITTING", "CONFIRMED"],
      "Booking confirmed."
    ],
    [
      "WAITLISTED",
      { ...booked, outcome: "WAITLISTED" },
      ["VALIDATED", "READY_TO_SUBMIT", "SUBMITTING", "CONFIRMED"],
      "Waitlist confirmed."
    ],
    [
      "ALREADY_BOOKED",
      alreadyBookedExact,
      ["VALIDATED"],
      "Existing booking confirmed."
    ],
    [
      "ALREADY_WAITLISTED",
      { ...alreadyBookedExact, outcome: "ALREADY_WAITLISTED" },
      ["VALIDATED"],
      "Existing waitlist confirmed."
    ],
    ["SAFE_STOP", safeStop, ["VALIDATED"], "Booking stopped safely."],
    [
      "TECHNICAL_FAILURE",
      technicalFailure,
      ["VALIDATED"],
      "Runtime operation failed."
    ],
    [
      "CONFIRMATION_UNCERTAIN",
      confirmationUncertain,
      ["VALIDATED", "READY_TO_SUBMIT", "SUBMITTING"],
      "Booking confirmation is uncertain."
    ]
  ] as const)(
    "replaces %s details with its fixed outcome marker",
    async (_outcome, executorResult, states, marker) => {
      const coordinator = new RuntimeCoordinator(
        request,
        new InMemoryRuntimeOperations()
      );

      const decision = await coordinator.run(async ({ advance }) => {
        for (const state of states) await advance(state);
        return {
          ...executorResult,
          details: "synthetic private session text"
        } as BookingResult;
      });

      expect(decision.result.details).toBe(marker);
    }
  );

  test.each([actionableDryRun, existingEnrollmentDryRun] as const)(
    "publishes a canonical %s result from VALIDATED unchanged",
    async (executorResult) => {
      const coordinator = new RuntimeCoordinator(
        request,
        new InMemoryRuntimeOperations()
      );

      await expect(
        coordinator.run(async ({ advance }) => {
          await advance("VALIDATED");
          return executorResult;
        })
      ).resolves.toEqual({ result: executorResult, publish: true });
    }
  );

  test("rejects a dry-run result after READY_TO_SUBMIT", async () => {
    const coordinator = new RuntimeCoordinator(
      request,
      new InMemoryRuntimeOperations()
    );

    await expect(
      coordinator.run(async ({ advance }) => {
        await advance("VALIDATED");
        await advance("READY_TO_SUBMIT");
        return actionableDryRun;
      })
    ).resolves.toMatchObject({
      result: { outcome: "TECHNICAL_FAILURE", exit_code: 30 }
    });
  });

  test("rejects dry-run submission evidence", async () => {
    const coordinator = new RuntimeCoordinator(
      request,
      new InMemoryRuntimeOperations()
    );

    await expect(
      coordinator.run(async ({ advance }) => {
        await advance("VALIDATED");
        return {
          ...actionableDryRun,
          action_submitted: true
        } as unknown as BookingResult;
      })
    ).resolves.toMatchObject({
      result: { outcome: "TECHNICAL_FAILURE", exit_code: 30 }
    });
  });

  test("rejects actionable dry-run evidence for a different configured package", async () => {
    const coordinator = new RuntimeCoordinator(
      request,
      new InMemoryRuntimeOperations()
    );

    await expect(
      coordinator.run(async ({ advance }) => {
        await advance("VALIDATED");
        return {
          ...actionableDryRun,
          packages_before: [
            {
              name: "Synthetic Other Package",
              remaining: 2,
              approved: true
            }
          ]
        } as unknown as BookingResult;
      })
    ).resolves.toMatchObject({
      result: { outcome: "TECHNICAL_FAILURE", exit_code: 30 }
    });
  });
});

describe("RuntimeCoordinator publication", () => {
  test("reports a preserved result as already published without rewriting it", async () => {
    const operations = new InMemoryRuntimeOperations();
    operations.failWriteResult = true;
    const coordinator = new RuntimeCoordinator(request, operations);

    await expect(
      coordinator.finalize({ result: booked, publish: false })
    ).resolves.toEqual({ result: booked, published: true });
  });

  test.each([
    [0, booked],
    [20, safeStop],
    [30, technicalFailure],
    [40, confirmationUncertain]
  ] as const)(
    "preserves an exit %i decision when result publication fails",
    async (_exitCode, selectedResult) => {
      const operations = new InMemoryRuntimeOperations();
      operations.failWriteResult = true;
      const coordinator = new RuntimeCoordinator(request, operations);
      const decision = { result: selectedResult, publish: true } as const;

      await expect(coordinator.finalize(decision)).resolves.toEqual({
        result: selectedResult,
        published: false
      });
    }
  );

  test("preserves post-submission uncertainty when result storage is unavailable", async () => {
    const operations = new InMemoryRuntimeOperations();
    operations.failReadJournalAfterSubmission = true;
    operations.failWriteResult = true;
    const coordinator = new RuntimeCoordinator(request, operations);

    const decision = await coordinator.run(async ({ advance }) => {
      await advance("VALIDATED");
      await advance("READY_TO_SUBMIT");
      await advance("SUBMITTING");
      throw new Error("synthetic executor failure");
    });

    await expect(coordinator.finalize(decision)).resolves.toMatchObject({
      result: { outcome: "CONFIRMATION_UNCERTAIN", exit_code: 40 },
      published: false
    });
  });
});

describe("RuntimeCoordinator recovery", () => {
  test("returns undefined without a journal", async () => {
    const coordinator = new RuntimeCoordinator(
      request,
      new InMemoryRuntimeOperations()
    );

    await expect(coordinator.recover()).resolves.toBeUndefined();
  });

  test("replays a matching valid result without publishing it", async () => {
    const operations = new InMemoryRuntimeOperations();
    operations.journal = {
      schema_version: 1,
      request_id: requestId,
      state: "INITIALIZED"
    };
    operations.result = technicalFailure;
    const coordinator = new RuntimeCoordinator(request, operations);

    await expect(coordinator.recover()).resolves.toEqual({
      result: technicalFailure,
      publish: false
    });
    expect(coordinator.lastDurableState).toBe("INITIALIZED");
  });

  test.each([
    [
      "foreign journal",
      {
        journal: {
          schema_version: 1,
          request_id: "00000000-0000-4000-8000-000000000004",
          state: "INITIALIZED"
        },
        result: undefined
      }
    ],
    [
      "foreign result",
      {
        journal: {
          schema_version: 1,
          request_id: requestId,
          state: "INITIALIZED"
        },
        result: {
          ...technicalFailure,
          request_id: "00000000-0000-4000-8000-000000000004"
        }
      }
    ]
  ] as const)(
    "returns a non-publishable technical failure for a %s",
    async (_case, artifacts) => {
      const operations = new InMemoryRuntimeOperations();
      operations.journal = artifacts.journal;
      operations.result = artifacts.result;
      const coordinator = new RuntimeCoordinator(request, operations);

      const decision = await coordinator.recover();

      expect(decision).toMatchObject({
        result: { outcome: "TECHNICAL_FAILURE", exit_code: 30 },
        publish: false
      });
      expect(operations.journal).toEqual(artifacts.journal);
      expect(operations.result).toEqual(artifacts.result);
    }
  );

  test.each([
    ["missing", undefined],
    ["malformed", {} as unknown as BookingResult],
    ["contradictory", technicalFailure]
  ] as const)(
    "classifies a matching SUBMITTING journal with a %s result as uncertainty",
    async (_case, result) => {
      const operations = new InMemoryRuntimeOperations();
      operations.journal = {
        schema_version: 1,
        request_id: requestId,
        state: "SUBMITTING"
      };
      if (_case === "malformed") {
        operations.resultStatus = { status: "invalid" };
      } else {
        operations.result = result as BookingResult | undefined;
      }
      const coordinator = new RuntimeCoordinator(request, operations);

      await expect(coordinator.recover()).resolves.toMatchObject({
        result: { outcome: "CONFIRMATION_UNCERTAIN", exit_code: 40 },
        publish: _case === "malformed" ? false : true
      });
      expect(coordinator.lastDurableState).toBe("SUBMITTING");
    }
  );

  test("replays recovered uncertainty from a matching CONFIRMED journal", async () => {
    const operations = new InMemoryRuntimeOperations();
    operations.journal = {
      schema_version: 1,
      request_id: requestId,
      state: "CONFIRMED"
    };
    operations.result = confirmationUncertain;
    const coordinator = new RuntimeCoordinator(request, operations);

    await expect(coordinator.recover()).resolves.toEqual({
      result: confirmationUncertain,
      publish: false
    });
  });

  test.each(["SUBMITTING", "CONFIRMED"] as const)(
    "turns a result read failure after %s into non-publishable uncertainty",
    async (state) => {
      const operations = new InMemoryRuntimeOperations();
      operations.journal = {
        schema_version: 1,
        request_id: requestId,
        state
      };
      operations.failReadResult = true;
      const coordinator = new RuntimeCoordinator(request, operations);

      await expect(coordinator.recover()).resolves.toMatchObject({
        result: {
          outcome: "CONFIRMATION_UNCERTAIN",
          exit_code: 40,
          details: "Booking confirmation is uncertain."
        },
        publish: false
      });
    }
  );

  test("does not replay a schema-invalid confirmed booking result", async () => {
    const operations = new InMemoryRuntimeOperations();
    operations.journal = {
      schema_version: 1,
      request_id: requestId,
      state: "CONFIRMED"
    };
    operations.resultStatus = {
      status: "invalid",
      inspectionRequestId: requestId
    };
    const coordinator = new RuntimeCoordinator(request, operations);

    await expect(coordinator.recover()).resolves.toMatchObject({
      result: {
        outcome: "CONFIRMATION_UNCERTAIN",
        exit_code: 40,
        details: "Booking confirmation is uncertain."
      },
      publish: true
    });
  });

  test("does not publish after a journal read failure leaves ownership unknown", async () => {
    const operations = new InMemoryRuntimeOperations();
    operations.failReadJournal = true;
    const coordinator = new RuntimeCoordinator(request, operations);

    await expect(coordinator.recover()).resolves.toMatchObject({
      result: {
        outcome: "TECHNICAL_FAILURE",
        exit_code: 30,
        details: "Runtime operation failed."
      },
      publish: false
    });
    expect(coordinator.lastDurableState).toBeUndefined();
  });

  test("classifies a pre-submission result read failure without leaking it", async () => {
    const operations = new InMemoryRuntimeOperations();
    operations.journal = {
      schema_version: 1,
      request_id: requestId,
      state: "VALIDATED"
    };
    operations.failReadResult = true;
    const coordinator = new RuntimeCoordinator(request, operations);

    await expect(coordinator.recover()).resolves.toMatchObject({
      result: {
        outcome: "TECHNICAL_FAILURE",
        exit_code: 30,
        details: "Runtime operation failed."
      },
      publish: false
    });
    expect(coordinator.lastDurableState).toBe("VALIDATED");
  });
});
