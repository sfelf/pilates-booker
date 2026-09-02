import { expect, it } from "vitest";

import type { BookingPage, BookingPageState } from "../src/booking-page.js";
import {
  executeBookingWorkflow,
  prepareBookingWorkflow
} from "../src/booking-workflow.js";
import type { BookingInput, ObservedClass } from "../src/contracts.js";

const observedClass: ObservedClass = {
  name: "Caller-selected class",
  instructor: "Synthetic Instructor",
  date: "2030-01-16",
  start_time: "10:30",
  end_time: "11:20",
  timezone: "America/Los_Angeles"
};

const input: BookingInput = {
  booking_url:
    "https://app.arketa.co/iframe/synthetic/calendar/checkout/workflow",
  allowed_packages: ["Synthetic Pack"],
  permitted_actions: ["book", "waitlist"],
  dry_run: true
};

function state(
  action: BookingPageState["observation"]["action"]
): BookingPageState {
  return {
    observation: {
      status: "observed",
      observed_class: observedClass,
      action,
      packages: [{ name: "Synthetic Pack", remaining: 2, approved: false }]
    },
    myself: { visibleCount: 1, selected: false, enabled: true },
    injuries: { visibleCount: 1, value: "", enabled: true },
    packages: [
      {
        row: 0,
        name: "Synthetic Pack",
        remaining: 2,
        active: true,
        product: false,
        control: { visibleCount: 1, selected: false, enabled: true }
      }
    ],
    cancellation: { visibleCount: 1, accepted: false, enabled: true },
    submission: {
      book: { visibleCount: 1, enabled: true },
      waitlist: { visibleCount: 1, enabled: true }
    },
    confirmation: { bookedVisibleCount: 0, waitlistedVisibleCount: 0 }
  };
}

function pageFor(pageState: BookingPageState): BookingPage {
  return {
    read: async () => pageState,
    selectMyself: async () => undefined,
    fillInjuriesIfEmpty: async () => undefined,
    selectPackage: async () => undefined,
    acceptCancellationPolicy: async () => undefined,
    submit: async () => undefined,
    waitForConfirmation: async () => ({ kind: "UNKNOWN" })
  };
}

it("accepts and returns the observed class without caller class comparison", async () => {
  const result = await prepareBookingWorkflow(
    {
      input,
      profileDir: "/private/runtime/Profile",
      advance: async () => undefined,
      log: async () => undefined
    },
    pageFor(state("book"))
  );

  expect(result).toMatchObject({
    schema_version: 2,
    outcome: "DRY_RUN",
    observed_class: observedClass,
    availability: "BOOKING_AVAILABLE",
    safety_checks: {
      approved_package_verified: true,
      no_charge: false,
      cancellation_policy_accepted: false
    }
  });
});

it("stops waitlist availability when the caller permits booking only", async () => {
  const result = await prepareBookingWorkflow(
    {
      input: { ...input, permitted_actions: ["book"] },
      profileDir: "/private/runtime/Profile",
      advance: async () => undefined,
      log: async () => undefined
    },
    pageFor(state("waitlist"))
  );

  expect(result).toMatchObject({ outcome: "SAFE_STOP", exit_code: 20 });
});

it.each([
  ["already_booked", "ALREADY_BOOKED"],
  ["already_waitlisted", "ALREADY_WAITLISTED"]
] as const)(
  "returns authoritative %s state without submission",
  async (action, outcome) => {
    const result = await prepareBookingWorkflow(
      {
        input: { ...input, dry_run: false },
        profileDir: "/private/runtime/Profile",
        advance: async () => undefined,
        log: async () => undefined
      },
      pageFor(state(action))
    );
    expect(result).toMatchObject({
      outcome,
      action_submitted: false,
      confirmation_verified: true,
      observed_class: observedClass
    });
  }
);

it("allows waitlisting by default during a zero-mutation dry run", async () => {
  const operations: string[] = [];
  const page = pageFor(state("waitlist"));
  const trackingPage: BookingPage = {
    ...page,
    selectMyself: async () => {
      operations.push("myself");
    },
    fillInjuriesIfEmpty: async () => {
      operations.push("injuries");
    },
    selectPackage: async () => {
      operations.push("package");
    },
    acceptCancellationPolicy: async () => {
      operations.push("cancellation");
    },
    submit: async () => {
      operations.push("submit");
    }
  };
  const result = await prepareBookingWorkflow(
    {
      input,
      profileDir: "/private/runtime/Profile",
      advance: async () => undefined,
      log: async () => undefined
    },
    trackingPage
  );
  expect(result).toMatchObject({
    outcome: "DRY_RUN",
    availability: "WAITLIST_AVAILABLE"
  });
  expect(operations).toEqual([]);
});

it.each([
  ["sold out", state("sold_out")],
  [
    "missing positive package",
    {
      ...state("book"),
      packages: [{ ...state("book").packages[0]!, remaining: 0 }]
    }
  ],
  [
    "ambiguous submission control",
    {
      ...state("book"),
      submission: {
        ...state("book").submission,
        book: { visibleCount: 2, enabled: true }
      }
    }
  ]
] as const)("stops safely for %s before mutation", async (_name, pageState) => {
  const operations: string[] = [];
  const page: BookingPage = {
    ...pageFor(pageState),
    selectMyself: async () => {
      operations.push("myself");
    },
    fillInjuriesIfEmpty: async () => {
      operations.push("injuries");
    },
    selectPackage: async () => {
      operations.push("package");
    },
    acceptCancellationPolicy: async () => {
      operations.push("cancellation");
    },
    submit: async () => {
      operations.push("submit");
    }
  };
  const result = await prepareBookingWorkflow(
    {
      input,
      profileDir: "/private/runtime/Profile",
      advance: async () => undefined,
      log: async () => undefined
    },
    page
  );
  expect(result).toMatchObject({ outcome: "SAFE_STOP", exit_code: 20 });
  expect(operations).toEqual([]);
});

it("uses the final observed class and submits exactly once without comparing metadata", async () => {
  const finalObserved = { ...observedClass, name: "Page metadata changed" };
  const initial = state("book");
  const final: BookingPageState = {
    ...state("book"),
    observation: {
      ...state("book").observation,
      observed_class: finalObserved
    },
    myself: { visibleCount: 1, selected: true, enabled: true },
    injuries: { visibleCount: 1, value: "None", enabled: true },
    packages: [
      {
        ...state("book").packages[0]!,
        control: { visibleCount: 1, selected: true, enabled: true }
      }
    ],
    selectedPackageRow: 0,
    cancellation: { visibleCount: 1, accepted: true, enabled: true }
  };
  const operations: string[] = [];
  let reads = 0;
  const page: BookingPage = {
    read: async () => (reads++ === 0 ? initial : final),
    selectMyself: async () => {
      operations.push("myself");
    },
    fillInjuriesIfEmpty: async () => {
      operations.push("injuries");
    },
    selectPackage: async () => {
      operations.push("package");
    },
    acceptCancellationPolicy: async () => {
      operations.push("cancellation");
    },
    submit: async (action) => {
      operations.push(`submit:${action}`);
    },
    waitForConfirmation: async () => ({ kind: "BOOKED" })
  };
  const stages: string[] = [];
  const liveInput = { ...input, dry_run: false };
  const result = await executeBookingWorkflow(
    {
      input: liveInput,
      profileDir: "/private/runtime/Profile",
      advance: async (stage) => {
        stages.push(stage);
      },
      log: async () => undefined
    },
    async (_profile, _url, use) => use(page)
  );

  expect(result).toMatchObject({
    outcome: "BOOKED",
    observed_class: finalObserved,
    action_submitted: true,
    confirmation_verified: true
  });
  expect(operations).toEqual([
    "myself",
    "injuries",
    "package",
    "cancellation",
    "submit:book"
  ]);
  expect(stages).toEqual([
    "VALIDATED",
    "READY_TO_SUBMIT",
    "SUBMITTING",
    "CONFIRMED"
  ]);
});
