import { describe, expect, it } from "vitest";

import type {
  BookingBrowser,
  BookingConfirmation,
  BookingPage,
  BookingPageState
} from "../src/booking-page.js";
import {
  BookingWorkflowError,
  executeBookingWorkflow,
  prepareBookingWorkflow,
  type BookingPreparation
} from "../src/booking-workflow.js";
import type { ExecutionContext } from "../src/cli.js";
import type {
  BookingPolicy,
  BookingRequest,
  BookingResult,
  JournalRecord,
  ObservedClass,
  PermittedAction
} from "../src/contracts.js";
import type { PackageOption } from "../src/package-selection.js";
import {
  RuntimeCoordinator,
  type RuntimeOperations
} from "../src/runtime-coordinator.js";

const observedClass: ObservedClass = {
  name: "Synthetic Reformer Flow",
  instructor: "Synthetic Instructor",
  date: "2030-01-16",
  start_time: "10:30",
  end_time: "11:20",
  timezone: "America/Los_Angeles"
};

const baseRequest: BookingRequest = {
  schema_version: 1,
  request_id: "00000000-0000-4000-8000-000000000006",
  booking_url:
    "https://app.arketa.co/iframe/synthetic/calendar/checkout/workflow",
  expected_class: {
    name: "Synthetic Reformer Flow",
    date: "2030-01-16",
    start_time: "10:30",
    timezone: "America/Los_Angeles"
  },
  reserve_for: "myself",
  permitted_actions: ["book", "waitlist"],
  policy_version: "2030-01-01",
  allow_monetary_charge: false,
  dry_run: false
};

const policy: BookingPolicy = {
  schema_version: 1,
  policy_version: "2030-01-01",
  allowed_packages: ["Synthetic Priority Pack", "Synthetic Backup Pack"]
};

const priorityPackage: PackageOption = {
  row: 2,
  name: "✨ Synthetic Priority Pack ✨",
  remaining: 3,
  active: true,
  product: false,
  control: { visibleCount: 1, selected: false, enabled: true }
};

const backupPackage: PackageOption = {
  row: 0,
  name: "Synthetic Backup Pack",
  remaining: 8,
  active: true,
  product: false,
  control: { visibleCount: 1, selected: false, enabled: true }
};

const unapprovedPackage: PackageOption = {
  row: 1,
  name: "Synthetic Unapproved Pack",
  remaining: 20,
  active: true,
  product: false,
  control: { visibleCount: 1, selected: false, enabled: true }
};

type StateOverrides = Readonly<{
  observed_class?: ObservedClass;
  action?: BookingPageState["observation"]["action"];
  myself?: BookingPageState["myself"];
  injuries?: BookingPageState["injuries"];
  packages?: readonly PackageOption[];
  selectedPackageRow?: number;
  cancellation?: BookingPageState["cancellation"];
  submission?: BookingPageState["submission"];
  confirmation?: BookingPageState["confirmation"];
}>;

function bookingState(overrides: StateOverrides = {}): BookingPageState {
  const packages = overrides.packages ?? [
    backupPackage,
    unapprovedPackage,
    priorityPackage
  ];
  const state: BookingPageState = {
    observation: {
      status: "observed",
      observed_class: overrides.observed_class ?? observedClass,
      action: overrides.action ?? "book",
      packages: [
        {
          name: "Synthetic Backup Pack",
          remaining: 8,
          approved: false
        },
        {
          name: "Synthetic Unapproved Pack",
          remaining: 20,
          approved: false
        },
        {
          name: "✨ Synthetic Priority Pack ✨",
          remaining: 3,
          approved: false
        }
      ]
    },
    myself: overrides.myself ?? {
      visibleCount: 1,
      selected: false,
      enabled: true
    },
    injuries: overrides.injuries ?? {
      visibleCount: 1,
      value: "",
      enabled: true
    },
    packages,
    cancellation: overrides.cancellation ?? {
      visibleCount: 1,
      accepted: false,
      enabled: true
    },
    submission: overrides.submission ?? {
      book: { visibleCount: 1, enabled: true },
      waitlist: { visibleCount: 1, enabled: true }
    },
    confirmation: overrides.confirmation ?? {
      bookedVisibleCount: 0,
      waitlistedVisibleCount: 0
    },
    ...(overrides.selectedPackageRow === undefined
      ? {}
      : { selectedPackageRow: overrides.selectedPackageRow })
  };
  return deepFreeze(state);
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

type Operation =
  | "read"
  | "selectMyself"
  | "fillInjuries:None"
  | `selectPackage:${number}`
  | "acceptCancellation"
  | `submit:${PermittedAction}`
  | `confirm:${PermittedAction}`
  | "close";

type FailingOperation =
  | "read"
  | "selectMyself"
  | "fillInjuries"
  | "selectPackage"
  | "acceptCancellation"
  | "submit"
  | "confirm";

class InMemoryBookingPage implements BookingPage {
  readonly operations: Operation[] = [];
  private reads = 0;

  constructor(
    private readonly states: readonly BookingPageState[],
    private readonly failingOperation?: FailingOperation,
    private readonly confirmation: BookingConfirmation = "UNKNOWN"
  ) {
    if (states.length === 0) throw new Error("test page requires state");
  }

  async read(): Promise<BookingPageState> {
    this.operations.push("read");
    this.failIfConfigured("read");
    const index = Math.min(this.reads, this.states.length - 1);
    this.reads += 1;
    return this.states[index]!;
  }

  async selectMyself(): Promise<void> {
    this.operations.push("selectMyself");
    this.failIfConfigured("selectMyself");
  }

  async fillInjuriesIfEmpty(value: "None"): Promise<void> {
    const current = this.states[Math.max(0, this.reads - 1)]!;
    if (current.injuries.value.trim().length === 0) {
      this.operations.push(`fillInjuries:${value}`);
    }
    this.failIfConfigured("fillInjuries");
  }

  async selectPackage(row: number): Promise<void> {
    this.operations.push(`selectPackage:${row}`);
    this.failIfConfigured("selectPackage");
  }

  async acceptCancellationPolicy(): Promise<void> {
    this.operations.push("acceptCancellation");
    this.failIfConfigured("acceptCancellation");
  }

  async submit(action: PermittedAction): Promise<void> {
    this.operations.push(`submit:${action}`);
    this.failIfConfigured("submit");
  }

  async waitForConfirmation(
    action: PermittedAction
  ): Promise<BookingConfirmation> {
    this.operations.push(`confirm:${action}`);
    this.failIfConfigured("confirm");
    return this.confirmation;
  }

  private failIfConfigured(operation: FailingOperation): void {
    if (this.failingOperation === operation) {
      throw new Error("private attendee and injuries values must stay hidden");
    }
  }
}

function inMemoryBookingBrowser(
  page: InMemoryBookingPage,
  failClose = false
): BookingBrowser {
  return async (_profileDir, _checkoutUrl, use) => {
    let result;
    try {
      result = await use(page);
    } catch (error) {
      page.operations.push("close");
      throw error;
    }
    page.operations.push("close");
    if (failClose) {
      throw new Error("private browser close failure");
    }
    return result;
  };
}

class WorkflowRuntimeOperations implements RuntimeOperations {
  journal: JournalRecord | undefined;

  async readJournal(): Promise<JournalRecord | undefined> {
    return this.journal;
  }

  async writeJournal(record: JournalRecord): Promise<void> {
    this.journal = record;
  }

  async readResult(): Promise<{ status: "missing" }> {
    return { status: "missing" };
  }

  async writeResult(result: BookingResult): Promise<void> {
    void result;
    throw new Error("not used by coordinator execution");
  }
}

async function runWorkflowThroughCoordinator(
  page: InMemoryBookingPage,
  browser: BookingBrowser = inMemoryBookingBrowser(page)
): Promise<{
  decision: Awaited<ReturnType<RuntimeCoordinator["run"]>>;
  executorError: unknown;
  durableState: JournalRecord["state"] | undefined;
}> {
  const operations = new WorkflowRuntimeOperations();
  const coordinator = new RuntimeCoordinator(baseRequest, operations);
  let executorError: unknown;
  const decision = await coordinator.run(async ({ request, advance }) => {
    try {
      return await executeBookingWorkflow(
        {
          request,
          policy,
          profileDir: "/private/synthetic/Profile",
          advance
        },
        browser
      );
    } catch (error) {
      executorError = error;
      throw error;
    }
  });
  return {
    decision,
    executorError,
    durableState: operations.journal?.state
  };
}

function executionContext(request: BookingRequest = baseRequest): {
  context: ExecutionContext;
  advances: string[];
} {
  const advances: string[] = [];
  return {
    context: {
      request,
      policy,
      profileDir: "/private/synthetic/Profile",
      advance: async (state) => {
        advances.push(state);
      }
    },
    advances
  };
}

function expectTerminal(
  preparation: BookingPreparation
): asserts preparation is Extract<BookingPreparation, { outcome: string }> {
  expect("outcome" in preparation).toBe(true);
}

describe("booking workflow dry-run decisions", () => {
  it.each([
    [1, 0],
    [0, 1]
  ] as const)(
    "stops safely when actionable dry run contradicts confirmation counts %i/%i",
    async (bookedVisibleCount, waitlistedVisibleCount) => {
      const page = new InMemoryBookingPage([
        bookingState({
          confirmation: { bookedVisibleCount, waitlistedVisibleCount }
        })
      ]);
      const { context } = executionContext({
        ...baseRequest,
        dry_run: true
      });

      const preparation = await prepareBookingWorkflow(context, page);

      expectSafeStop(preparation, true);
      expect(page.operations).toEqual(["read"]);
      expectNoSubmission(page);
    }
  );

  it.each([
    ["book", "BOOKING_AVAILABLE"],
    ["waitlist", "WAITLIST_AVAILABLE"]
  ] as const)(
    "publishes canonical %s availability after one read and zero mutation",
    async (action, availability) => {
      const page = new InMemoryBookingPage([
        bookingState({
          action,
          injuries: {
            visibleCount: 1,
            value: "private injury answer",
            enabled: true
          }
        })
      ]);
      const { context, advances } = executionContext({
        ...baseRequest,
        dry_run: true
      });

      const preparation = await prepareBookingWorkflow(context, page);

      expectTerminal(preparation);
      expect(preparation).toEqual({
        schema_version: 1,
        request_id: baseRequest.request_id,
        outcome: "DRY_RUN",
        exit_code: 0,
        action_submitted: false,
        confirmation_verified: false,
        availability,
        observed_class: observedClass,
        package_selected: "Synthetic Priority Pack",
        packages_before: [
          {
            name: "Synthetic Backup Pack",
            remaining: 8,
            approved: true
          },
          {
            name: "Synthetic Unapproved Pack",
            remaining: 20,
            approved: false
          },
          {
            name: "✨ Synthetic Priority Pack ✨",
            remaining: 3,
            approved: true
          }
        ],
        safety_checks: {
          exact_class_match: true,
          approved_package_verified: true,
          no_charge: false,
          cancellation_policy_accepted: false
        },
        details: "Dry run completed."
      });
      expect(page.operations).toEqual(["read"]);
      expect(advances).toEqual(["VALIDATED"]);
      expect(JSON.stringify(preparation)).not.toContain(
        "private injury answer"
      );
    }
  );

  it.each([
    ["already_booked", "ALREADY_BOOKED"],
    ["already_waitlisted", "ALREADY_WAITLISTED"]
  ] as const)(
    "publishes canonical dry-run evidence for %s without package or private fields",
    async (action, availability) => {
      const page = new InMemoryBookingPage([
        bookingState({
          action,
          injuries: {
            visibleCount: 1,
            value: "private enrollment answer",
            enabled: true
          }
        })
      ]);
      const { context } = executionContext({
        ...baseRequest,
        dry_run: true
      });

      const preparation = await prepareBookingWorkflow(context, page);

      expectTerminal(preparation);
      expect(preparation).toEqual({
        schema_version: 1,
        request_id: baseRequest.request_id,
        outcome: "DRY_RUN",
        exit_code: 0,
        action_submitted: false,
        confirmation_verified: true,
        availability,
        observed_class: observedClass,
        safety_checks: {
          exact_class_match: true,
          approved_package_verified: false,
          no_charge: false,
          cancellation_policy_accepted: false
        },
        details: "Dry run completed."
      });
      expect(page.operations).toEqual(["read"]);
      expect(JSON.stringify(preparation)).not.toContain("private");
    }
  );

  it.each([
    [
      "missing action control",
      bookingState({
        submission: {
          book: { visibleCount: 0, enabled: false },
          waitlist: { visibleCount: 1, enabled: true }
        }
      })
    ],
    [
      "duplicate action controls",
      bookingState({
        submission: {
          book: { visibleCount: 2, enabled: true },
          waitlist: { visibleCount: 1, enabled: true }
        }
      })
    ],
    [
      "disabled action control",
      bookingState({
        submission: {
          book: { visibleCount: 1, enabled: false },
          waitlist: { visibleCount: 1, enabled: true }
        }
      })
    ],
    [
      "missing selected package control",
      bookingState({
        packages: [
          backupPackage,
          unapprovedPackage,
          {
            ...priorityPackage,
            control: { visibleCount: 0, selected: false, enabled: false }
          }
        ]
      })
    ],
    [
      "duplicate selected package controls",
      bookingState({
        packages: [
          backupPackage,
          unapprovedPackage,
          {
            ...priorityPackage,
            control: { visibleCount: 2, selected: false, enabled: true }
          }
        ]
      })
    ],
    [
      "disabled selected package control",
      bookingState({
        packages: [
          backupPackage,
          unapprovedPackage,
          {
            ...priorityPackage,
            control: { visibleCount: 1, selected: false, enabled: false }
          }
        ]
      })
    ]
  ] as const)("safe stops without mutation for %s", async (_case, state) => {
    const page = new InMemoryBookingPage([state]);
    const { context, advances } = executionContext({
      ...baseRequest,
      dry_run: true
    });

    const preparation = await prepareBookingWorkflow(context, page);

    expectTerminal(preparation);
    expect(preparation).toEqual({
      schema_version: 1,
      request_id: baseRequest.request_id,
      outcome: "SAFE_STOP",
      exit_code: 20,
      action_submitted: false,
      confirmation_verified: false,
      safety_checks: {
        exact_class_match: true,
        approved_package_verified: false,
        no_charge: false,
        cancellation_policy_accepted: false
      },
      details: "Booking stopped safely."
    });
    expect(page.operations).toEqual(["read"]);
    expect(advances).toEqual(["VALIDATED"]);
  });
});

describe("booking workflow existing-enrollment decisions", () => {
  it.each([
    ["already_booked", "ALREADY_BOOKED", "Existing booking confirmed."],
    ["already_waitlisted", "ALREADY_WAITLISTED", "Existing waitlist confirmed."]
  ] as const)(
    "returns %s with no mutation",
    async (action, outcome, details) => {
      const page = new InMemoryBookingPage([
        bookingState({
          action,
          injuries: {
            visibleCount: 1,
            value: "private attendee injury data",
            enabled: true
          }
        })
      ]);
      const { context, advances } = executionContext();

      const preparation = await prepareBookingWorkflow(context, page);

      expectTerminal(preparation);
      expect(preparation).toEqual({
        schema_version: 1,
        request_id: baseRequest.request_id,
        outcome,
        exit_code: 0,
        action_submitted: false,
        confirmation_verified: true,
        observed_class: observedClass,
        safety_checks: {
          exact_class_match: true,
          approved_package_verified: false,
          no_charge: false,
          cancellation_policy_accepted: false
        },
        details
      });
      expect(page.operations).toEqual(["read"]);
      expect(advances).toEqual(["VALIDATED"]);
      expect(JSON.stringify(preparation)).not.toContain("private");
    }
  );
});

const selectedPriorityPackage: PackageOption = {
  ...priorityPackage,
  control: { visibleCount: 1, selected: true, enabled: true }
};

function authorizedFinalState(
  overrides: StateOverrides = {}
): BookingPageState {
  return bookingState({
    action: overrides.action ?? "book",
    ...(overrides.observed_class === undefined
      ? {}
      : { observed_class: overrides.observed_class }),
    myself: overrides.myself ?? {
      visibleCount: 1,
      selected: true,
      enabled: true
    },
    injuries: overrides.injuries ?? {
      visibleCount: 1,
      value: "PRESENT",
      enabled: true
    },
    packages: overrides.packages ?? [
      backupPackage,
      unapprovedPackage,
      selectedPriorityPackage
    ],
    selectedPackageRow: overrides.selectedPackageRow ?? 2,
    cancellation: overrides.cancellation ?? {
      visibleCount: 1,
      accepted: true,
      enabled: true
    },
    ...(overrides.submission === undefined
      ? {}
      : { submission: overrides.submission }),
    ...(overrides.confirmation === undefined
      ? {}
      : { confirmation: overrides.confirmation })
  });
}

function expectSafeStop(
  preparation: BookingPreparation | BookingResult,
  exactClassMatch: boolean
): void {
  expect("outcome" in preparation).toBe(true);
  expect(preparation).toEqual({
    schema_version: 1,
    request_id: baseRequest.request_id,
    outcome: "SAFE_STOP",
    exit_code: 20,
    action_submitted: false,
    confirmation_verified: false,
    safety_checks: {
      exact_class_match: exactClassMatch,
      approved_package_verified: false,
      no_charge: false,
      cancellation_policy_accepted: false
    },
    details: "Booking stopped safely."
  });
}

function expectNoSubmission(page: InMemoryBookingPage): void {
  expect(
    page.operations.some(
      (operation) =>
        operation.startsWith("submit:") || operation.startsWith("confirm:")
    )
  ).toBe(false);
}

describe("booking workflow final pre-submission authorization", () => {
  it("authorizes the configured priority package after ordered mutations and one coherent re-read", async () => {
    const page = new InMemoryBookingPage([
      bookingState(),
      authorizedFinalState()
    ]);
    const { context, advances } = executionContext();

    const preparation = await prepareBookingWorkflow(context, page);

    expect(preparation).toEqual({
      status: "authorized",
      action: "book",
      observed_class: observedClass,
      selection: {
        option: priorityPackage,
        configuredName: "Synthetic Priority Pack",
        balances: [
          {
            name: "Synthetic Backup Pack",
            remaining: 8,
            approved: true
          },
          {
            name: "Synthetic Unapproved Pack",
            remaining: 20,
            approved: false
          },
          {
            name: "✨ Synthetic Priority Pack ✨",
            remaining: 3,
            approved: true
          }
        ]
      },
      safety_checks: {
        exact_class_match: true,
        approved_package_verified: true,
        no_charge: true,
        cancellation_policy_accepted: true
      }
    });
    expect(page.operations).toEqual([
      "read",
      "selectMyself",
      "fillInjuries:None",
      "selectPackage:2",
      "acceptCancellation",
      "read"
    ]);
    expect(advances).toEqual(["VALIDATED"]);
    expectNoSubmission(page);
  });

  it.each([
    "private raw answer\nsecond line",
    "private\\n escaped answer",
    "private%0Aencoded%20answer",
    "private%250Arepeated%2520answer"
  ])(
    "preserves a non-empty injuries representation without projecting it: %s",
    async (privateAnswer) => {
      const initial = bookingState({
        myself: { visibleCount: 1, selected: true, enabled: true },
        injuries: {
          visibleCount: 1,
          value: privateAnswer,
          enabled: true
        }
      });
      const page = new InMemoryBookingPage([initial, authorizedFinalState()]);
      const { context } = executionContext();

      const preparation = await prepareBookingWorkflow(context, page);

      expect(preparation).toMatchObject({ status: "authorized" });
      expect(page.operations).toEqual([
        "read",
        "selectPackage:2",
        "acceptCancellation",
        "read"
      ]);
      expect(JSON.stringify(preparation)).not.toContain("private");
      expectNoSubmission(page);
    }
  );

  it("replaces an unapproved preselected package with the configured priority", async () => {
    const unapprovedSelected: PackageOption = {
      ...unapprovedPackage,
      control: { visibleCount: 1, selected: true, enabled: true }
    };
    const page = new InMemoryBookingPage([
      bookingState({
        packages: [backupPackage, unapprovedSelected, priorityPackage],
        selectedPackageRow: 1
      }),
      authorizedFinalState()
    ]);
    const { context } = executionContext();

    const preparation = await prepareBookingWorkflow(context, page);

    expect(preparation).toMatchObject({
      status: "authorized",
      selection: {
        option: { row: 2, name: "✨ Synthetic Priority Pack ✨" }
      }
    });
    expect(page.operations).toContain("selectPackage:2");
    expectNoSubmission(page);
  });

  it("authorizes the exact permitted waitlist action", async () => {
    const page = new InMemoryBookingPage([
      bookingState({ action: "waitlist" }),
      authorizedFinalState({ action: "waitlist" })
    ]);
    const { context } = executionContext();

    const preparation = await prepareBookingWorkflow(context, page);

    expect(preparation).toMatchObject({
      status: "authorized",
      action: "waitlist",
      safety_checks: { no_charge: true }
    });
    expectNoSubmission(page);
  });

  it("allows the matching submission control to become enabled after prerequisites", async () => {
    const page = new InMemoryBookingPage([
      bookingState({
        submission: {
          book: { visibleCount: 1, enabled: false },
          waitlist: { visibleCount: 1, enabled: true }
        }
      }),
      authorizedFinalState()
    ]);
    const { context } = executionContext();

    const preparation = await prepareBookingWorkflow(context, page);

    expect(preparation).toMatchObject({
      status: "authorized",
      action: "book"
    });
    expect(page.operations).toEqual([
      "read",
      "selectMyself",
      "fillInjuries:None",
      "selectPackage:2",
      "acceptCancellation",
      "read"
    ]);
    expectNoSubmission(page);
  });
});

describe("booking workflow initial safe stops", () => {
  it("stops safely when the checkout requires login without exposing the failure", async () => {
    const page = new InMemoryBookingPage([bookingState()], "read");
    const { context, advances } = executionContext();

    const preparation = await prepareBookingWorkflow(context, page);

    expectSafeStop(preparation, false);
    expect(page.operations).toEqual(["read"]);
    expect(advances).toEqual(["VALIDATED"]);
    expect(JSON.stringify(preparation)).not.toContain("private");
  });

  it("stops safely for an exact-class mismatch", async () => {
    const page = new InMemoryBookingPage([
      bookingState({
        observed_class: { ...observedClass, name: "Different private class" }
      })
    ]);
    const { context } = executionContext();

    const preparation = await prepareBookingWorkflow(context, page);

    expectSafeStop(preparation, false);
    expect(page.operations).toEqual(["read"]);
    expect(JSON.stringify(preparation)).not.toContain("Different private");
  });

  it.each([
    ["sold out", bookingState({ action: "sold_out" }), baseRequest],
    [
      "disallowed waitlist",
      bookingState({ action: "waitlist" }),
      { ...baseRequest, permitted_actions: ["book"] as const }
    ],
    [
      "zero approved balance",
      bookingState({
        packages: [
          { ...backupPackage, remaining: 0 },
          { ...priorityPackage, remaining: 0 }
        ]
      }),
      baseRequest
    ],
    [
      "missing approved package",
      bookingState({
        packages: [
          {
            row: 4,
            name: "Synthetic Other Pack",
            remaining: 4,
            active: true,
            product: false,
            control: { visibleCount: 1, selected: false, enabled: true }
          }
        ]
      }),
      baseRequest
    ],
    [
      "duplicate normalized package",
      bookingState({
        packages: [
          backupPackage,
          unapprovedPackage,
          priorityPackage,
          { ...priorityPackage, row: 3, name: "Synthetic Priority Pack" }
        ]
      }),
      baseRequest
    ]
  ] as const)("stops safely for %s", async (_case, initial, request) => {
    const page = new InMemoryBookingPage([initial]);
    const { context } = executionContext(request);

    const preparation = await prepareBookingWorkflow(context, page);

    expectSafeStop(preparation, true);
    expect(page.operations).toEqual(["read"]);
    expectNoSubmission(page);
  });

  it.each([
    [
      "disabled Myself",
      bookingState({
        myself: { visibleCount: 1, selected: false, enabled: false }
      })
    ],
    [
      "multiple Myself controls",
      bookingState({
        myself: { visibleCount: 2, selected: false, enabled: true }
      })
    ],
    [
      "disabled injuries",
      bookingState({
        injuries: { visibleCount: 1, value: "", enabled: false }
      })
    ],
    [
      "disabled selected package target",
      bookingState({
        packages: [
          backupPackage,
          unapprovedPackage,
          {
            ...priorityPackage,
            control: { visibleCount: 1, selected: false, enabled: false }
          }
        ]
      })
    ],
    [
      "disabled cancellation",
      bookingState({
        cancellation: { visibleCount: 1, accepted: false, enabled: false }
      })
    ]
  ] as const)("does not mutate when %s is unusable", async (_case, initial) => {
    const page = new InMemoryBookingPage([initial]);
    const { context } = executionContext();

    const preparation = await prepareBookingWorkflow(context, page);

    expectSafeStop(preparation, true);
    expect(page.operations).toEqual(["read"]);
    expectNoSubmission(page);
  });
});

describe("booking workflow final coherent-read safe stops", () => {
  const driftCases = [
    [
      "Myself is no longer selected",
      authorizedFinalState({
        myself: { visibleCount: 1, selected: false, enabled: true }
      }),
      true
    ],
    [
      "injuries remains empty",
      authorizedFinalState({
        injuries: { visibleCount: 1, value: "", enabled: true }
      }),
      true
    ],
    [
      "the approved package is not selected",
      authorizedFinalState({ selectedPackageRow: 0 }),
      true
    ],
    [
      "the selected package loses its positive balance",
      authorizedFinalState({
        packages: [
          backupPackage,
          unapprovedPackage,
          { ...selectedPriorityPackage, remaining: 0 }
        ]
      }),
      true
    ],
    ["the action changes", authorizedFinalState({ action: "waitlist" }), true],
    [
      "the exact class changes",
      authorizedFinalState({
        observed_class: { ...observedClass, start_time: "10:31" }
      }),
      false
    ],
    [
      "cancellation is not accepted",
      authorizedFinalState({
        cancellation: { visibleCount: 1, accepted: false, enabled: true }
      }),
      true
    ],
    [
      "the matching submission control is disabled",
      authorizedFinalState({
        submission: {
          book: { visibleCount: 1, enabled: false },
          waitlist: { visibleCount: 1, enabled: true }
        }
      }),
      true
    ],
    [
      "a booking confirmation is already visible",
      authorizedFinalState({
        confirmation: {
          bookedVisibleCount: 1,
          waitlistedVisibleCount: 0
        }
      }),
      true
    ],
    [
      "a waitlist confirmation is already visible",
      authorizedFinalState({
        confirmation: {
          bookedVisibleCount: 0,
          waitlistedVisibleCount: 1
        }
      }),
      true
    ]
  ] as const;

  it.each(driftCases)(
    "stops safely when %s",
    async (_case, finalState, exactClassMatch) => {
      const page = new InMemoryBookingPage([bookingState(), finalState]);
      const { context, advances } = executionContext();

      const preparation = await prepareBookingWorkflow(context, page);

      expectSafeStop(preparation, exactClassMatch);
      expect(page.operations).toEqual([
        "read",
        "selectMyself",
        "fillInjuries:None",
        "selectPackage:2",
        "acceptCancellation",
        "read"
      ]);
      expect(advances).toEqual(["VALIDATED"]);
      expectNoSubmission(page);
    }
  );

  it("stops safely when cancellation acceptance fails", async () => {
    const page = new InMemoryBookingPage(
      [bookingState(), authorizedFinalState()],
      "acceptCancellation"
    );
    const { context } = executionContext();

    const preparation = await prepareBookingWorkflow(context, page);

    expectSafeStop(preparation, true);
    expect(page.operations).toEqual([
      "read",
      "selectMyself",
      "fillInjuries:None",
      "selectPackage:2",
      "acceptCancellation"
    ]);
    expect(JSON.stringify(preparation)).not.toContain("private");
    expectNoSubmission(page);
  });
});

describe("booking workflow confirmed submission", () => {
  it("returns a terminal preparation unchanged and closes without submission", async () => {
    const page = new InMemoryBookingPage([bookingState()]);
    const { context, advances } = executionContext({
      ...baseRequest,
      dry_run: true
    });
    const browserInputs: unknown[] = [];
    let callbackResult: unknown;
    const browser: BookingBrowser = async (profileDir, checkoutUrl, use) => {
      browserInputs.push(profileDir, checkoutUrl);
      try {
        const result = await use(page);
        callbackResult = result;
        return result;
      } finally {
        page.operations.push("close");
      }
    };

    const result = await executeBookingWorkflow(context, browser);

    expect(result).toBe(callbackResult);
    expect(result).toMatchObject({
      outcome: "DRY_RUN",
      action_submitted: false
    });
    expect(browserInputs).toEqual([
      context.profileDir,
      context.request.booking_url
    ]);
    expect(page.operations).toEqual(["read", "close"]);
    expect(advances).toEqual(["VALIDATED"]);
  });

  it.each([
    ["book", "BOOKED", "Booking confirmed."],
    ["waitlist", "WAITLISTED", "Waitlist confirmed."]
  ] as const)(
    "confirms one exact %s submission without a post-submit reread",
    async (action, outcome, details) => {
      const page = new InMemoryBookingPage(
        [bookingState({ action }), authorizedFinalState({ action })],
        undefined,
        outcome
      );
      const { context, advances } = executionContext();

      const result = await executeBookingWorkflow(
        context,
        inMemoryBookingBrowser(page)
      );

      expect(result).toEqual({
        schema_version: 1,
        request_id: baseRequest.request_id,
        outcome,
        exit_code: 0,
        action_submitted: true,
        confirmation_verified: true,
        observed_class: observedClass,
        package_selected: "Synthetic Priority Pack",
        packages_before: [
          {
            name: "Synthetic Backup Pack",
            remaining: 8,
            approved: true
          },
          {
            name: "Synthetic Unapproved Pack",
            remaining: 20,
            approved: false
          },
          {
            name: "✨ Synthetic Priority Pack ✨",
            remaining: 3,
            approved: true
          }
        ],
        safety_checks: {
          exact_class_match: true,
          approved_package_verified: true,
          no_charge: true,
          cancellation_policy_accepted: true
        },
        details
      });
      expect(page.operations.slice(-3)).toEqual([
        `submit:${action}`,
        `confirm:${action}`,
        "close"
      ]);
      expect(page.operations).toEqual([
        "read",
        "selectMyself",
        "fillInjuries:None",
        "selectPackage:2",
        "acceptCancellation",
        "read",
        `submit:${action}`,
        `confirm:${action}`,
        "close"
      ]);
      expect(
        page.operations.filter((operation) => operation === "read")
      ).toHaveLength(2);
      expect(
        page.operations.filter((operation) => operation === `submit:${action}`)
      ).toHaveLength(1);
      expect(advances).toEqual([
        "VALIDATED",
        "READY_TO_SUBMIT",
        "SUBMITTING",
        "CONFIRMED"
      ]);
    }
  );
});

describe("booking workflow post-submit uncertainty", () => {
  it.each([
    [
      "timeout/unknown confirmation",
      undefined,
      "UNKNOWN",
      false,
      "SUBMITTING",
      1
    ],
    [
      "wrong waitlist confirmation after book",
      undefined,
      "WAITLISTED",
      false,
      "SUBMITTING",
      1
    ],
    [
      "conflicting confirmation evidence",
      undefined,
      "UNKNOWN",
      false,
      "SUBMITTING",
      1
    ],
    ["submission page throw", "submit", "UNKNOWN", false, "SUBMITTING", 0],
    ["confirmation page throw", "confirm", "BOOKED", false, "SUBMITTING", 1],
    ["browser close failure", undefined, "BOOKED", true, "CONFIRMED", 1]
  ] as const)(
    "classifies %s from durable state without a second click",
    async (
      _case,
      failingOperation,
      confirmation,
      failClose,
      durableState,
      confirmationCalls
    ) => {
      const page = new InMemoryBookingPage(
        [bookingState(), authorizedFinalState()],
        failingOperation,
        confirmation
      );

      const run = await runWorkflowThroughCoordinator(
        page,
        inMemoryBookingBrowser(page, failClose)
      );

      expect(run.decision).toEqual({
        result: {
          schema_version: 1,
          request_id: baseRequest.request_id,
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
        },
        publish: true
      });
      expect(run.executorError).toBeInstanceOf(BookingWorkflowError);
      expect(String(run.executorError)).toBe(
        "BookingWorkflowError: Booking workflow failed."
      );
      expect(run.durableState).toBe(durableState);
      expect(
        page.operations.filter((operation) => operation === "submit:book")
      ).toHaveLength(1);
      expect(
        page.operations.filter((operation) => operation === "confirm:book")
      ).toHaveLength(confirmationCalls);
      expect(page.operations.at(-1)).toBe("close");
      expect(JSON.stringify(run)).not.toContain("private browser");
    }
  );

  it("classifies a schema-invalid result construction after the click", async () => {
    const incompleteObservedClass = {
      ...observedClass,
      instructor: ""
    };
    const page = new InMemoryBookingPage(
      [
        bookingState({ observed_class: incompleteObservedClass }),
        authorizedFinalState({ observed_class: incompleteObservedClass })
      ],
      undefined,
      "BOOKED"
    );

    const run = await runWorkflowThroughCoordinator(page);

    expect(run.decision).toMatchObject({
      result: {
        outcome: "CONFIRMATION_UNCERTAIN",
        exit_code: 40,
        action_submitted: true,
        confirmation_verified: false
      }
    });
    expect(run.executorError).toBeInstanceOf(BookingWorkflowError);
    expect(String(run.executorError)).toBe(
      "BookingWorkflowError: Booking workflow failed."
    );
    expect(run.durableState).toBe("CONFIRMED");
    expect(
      page.operations.filter((operation) => operation === "submit:book")
    ).toHaveLength(1);
    expect(page.operations.slice(-3)).toEqual([
      "submit:book",
      "confirm:book",
      "close"
    ]);
  });
});
