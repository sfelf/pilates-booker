import type { CheckoutPageReader } from "../../src/checkout-reader.js";
import type {
  RawCheckoutSnapshot,
  RawOffering
} from "../../src/checkout-inspection.js";
import type { CheckoutAction } from "../../src/contracts.js";
import type { ObservedClass } from "../../src/contracts.js";

export const selectors = {
  authenticated: '[data-testid="authenticated"]',
  loginRequired: '[data-testid="login-required"]',
  className: '[data-testid="class-name"]',
  instructor: '[data-testid="instructor"]',
  classDate: '[data-testid="class-date"]',
  startTime: '[data-testid="start-time"]',
  endTime: '[data-testid="end-time"]',
  timezone: '[data-testid="timezone"]',
  package: '[data-testid="offering"]',
  book: '[data-testid="action-book"]',
  waitlist: '[data-testid="action-waitlist"]',
  soldOut: '[data-testid="state-sold-out"]',
  alreadyBooked: '[data-testid="state-already-booked"]',
  alreadyWaitlisted: '[data-testid="state-already-waitlisted"]'
} as const;

type ElementFixture = Readonly<{
  text?: string;
  attributes?: Readonly<Record<string, string>>;
}>;

export type CheckoutFixture = Readonly<
  Partial<
    Record<
      (typeof selectors)[keyof typeof selectors],
      readonly ElementFixture[]
    >
  >
>;

type BookingPageFixtureAction = CheckoutAction | "book_and_already_booked";

export type BookingPageFixtureOptions = Readonly<{
  action?: BookingPageFixtureAction;
  myselfCount?: number;
  myselfSelected?: boolean;
  injuries?: readonly string[];
  injuriesRequiredMarker?: boolean;
  injuriesType?: string;
  injuriesAriaLabel?: string;
  packageControlCounts?: readonly number[];
  selectedPackageRows?: readonly number[];
  cancellationCount?: number;
  cancellationType?: string;
  cancellationAriaLabel?: string;
  bookedConfirmations?: number;
  waitlistedConfirmations?: number;
  confirmationsHidden?: boolean;
}>;

const SYNTHETIC_PACKAGES = [
  {
    name: "Studio / 10-Class Pack",
    kind: "class_package",
    remaining: "3",
    active: "true"
  },
  {
    name: "Intro / 5-Class Pack",
    kind: "class_package",
    remaining: "1",
    active: "true"
  },
  {
    name: "Grip Socks — Édition limitée",
    kind: "product",
    remaining: "20",
    active: "true"
  }
] as const;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function repeated(count: number, render: (index: number) => string): string {
  return Array.from({ length: count }, (_, index) => render(index)).join("");
}

function actionHtml(action: BookingPageFixtureAction): string {
  switch (action) {
    case "book":
      return '<button data-testid="action-book" type="button">Book</button>';
    case "waitlist":
      return '<button data-testid="action-waitlist" type="button">Join the waitlist</button>';
    case "sold_out":
      return '<div data-testid="state-sold-out">Sold out</div>';
    case "already_booked":
      return '<div data-testid="state-already-booked">Already booked</div>';
    case "already_waitlisted":
      return '<div data-testid="state-already-waitlisted">Already waitlisted</div>';
    case "book_and_already_booked":
      return `${actionHtml("book")}${actionHtml("already_booked")}`;
  }
}

export function bookingPageHtml(
  options: BookingPageFixtureOptions = {}
): string {
  const action = options.action ?? "book";
  const injuries = options.injuries ?? ["Synthetic existing answer"];
  const packageControlCounts = options.packageControlCounts ?? [1, 1, 0];
  const selectedRows = new Set(options.selectedPackageRows ?? [0]);
  const confirmationVisibility =
    options.confirmationsHidden === false ? "" : " hidden";

  const myself = repeated(
    options.myselfCount ?? 1,
    (index) => `
    <label for="reserve-myself-${index}">Myself</label>
    <input id="reserve-myself-${index}" type="radio" name="reserveFor"${index === 0 && options.myselfSelected !== false ? " checked" : ""}>
  `
  );
  const injuriesHtml = injuries
    .map(
      (value, index) => `
        <label for="injuries-${index}">Do you have any injuries?${options.injuriesRequiredMarker === false ? "" : " *"}</label>
        <input id="injuries-${index}" type="${escapeHtml(options.injuriesType ?? "text")}"${options.injuriesAriaLabel === undefined ? "" : ` aria-label="${escapeHtml(options.injuriesAriaLabel)}"`} value="${escapeHtml(value)}">
      `
    )
    .join("");
  const packageHtml = SYNTHETIC_PACKAGES.map((entry, row) => {
    const controls = repeated(
      packageControlCounts[row] ?? 0,
      (index) => `
      <input
        aria-label="Select ${escapeHtml(entry.name)}"
        type="radio"
        name="package"
        ${selectedRows.has(row) && index === 0 ? "checked" : ""}
      >
    `
    );
    return `
      <div
        data-testid="offering"
        data-kind="${entry.kind}"
        data-remaining="${entry.remaining}"
        data-active="${entry.active}"
      >${escapeHtml(entry.name)}${controls}</div>
    `;
  }).join("");
  const cancellation = repeated(
    options.cancellationCount ?? 1,
    (index) => `
    <label for="cancellation-${index}">I agree to the Cancellation Policy</label>
    <input id="cancellation-${index}" type="${escapeHtml(options.cancellationType ?? "checkbox")}"${options.cancellationAriaLabel === undefined ? "" : ` aria-label="${escapeHtml(options.cancellationAriaLabel)}"`}>
  `
  );
  const booked = repeated(
    options.bookedConfirmations ?? 1,
    () => `
    <div data-testid="confirmation-booked"${confirmationVisibility}>You are Booked!</div>
  `
  );
  const waitlisted = repeated(
    options.waitlistedConfirmations ?? 1,
    () => `
    <div data-testid="confirmation-waitlisted"${confirmationVisibility}>You're on the waitlist</div>
  `
  );

  return `<!doctype html>
    <html>
      <body>
        <div data-testid="authenticated">Signed in as synthetic-private@example.test</div>
        <section data-testid="class">
          <span data-testid="class-name">Reformer – Début ✨</span>
          <span data-testid="instructor">Ana O’Neil</span>
          <span data-testid="class-date">2026-09-01</span>
          <span data-testid="start-time">09:30</span>
          <span data-testid="end-time">10:20</span>
          <span data-testid="timezone">America/Los_Angeles</span>
        </section>
        ${actionHtml(action)}
        ${myself}
        ${injuriesHtml}
        ${packageHtml}
        ${cancellation}
        <label for="marketing">Receive studio updates</label>
        <input id="marketing" type="checkbox">
        ${booked}
        ${waitlisted}
      </body>
    </html>`;
}

export function bookingFixture(): CheckoutFixture {
  return {
    [selectors.authenticated]: [{}],
    [selectors.className]: [{ text: "Reformer – Début ✨" }],
    [selectors.instructor]: [{ text: "Ana O’Neil" }],
    [selectors.classDate]: [{ text: "2026-09-01" }],
    [selectors.startTime]: [{ text: "09:30" }],
    [selectors.endTime]: [{ text: "10:20" }],
    [selectors.timezone]: [{ text: "America/Los_Angeles" }],
    [selectors.book]: [{}],
    [selectors.package]: [
      {
        text: "Studio / 10-Class Pack",
        attributes: {
          "data-kind": "class_package",
          "data-remaining": "3",
          "data-active": "true"
        }
      },
      {
        text: "Grip Socks — Édition limitée",
        attributes: {
          "data-kind": "product",
          "data-remaining": "20",
          "data-active": "true"
        }
      }
    ]
  };
}

export class FixtureCheckoutPage implements CheckoutPageReader {
  readonly operations: string[] = [];

  constructor(private readonly fixture: CheckoutFixture) {}

  async snapshot(): Promise<RawCheckoutSnapshot> {
    this.operations.push("snapshot");
    const classes = await this.classesFromFixture();
    const actions = [
      [selectors.book, "book"],
      [selectors.waitlist, "waitlist"],
      [selectors.soldOut, "sold_out"],
      [selectors.alreadyBooked, "already_booked"],
      [selectors.alreadyWaitlisted, "already_waitlisted"]
    ].flatMap(([selector, action]) =>
      (this.fixture[selector as keyof CheckoutFixture]?.length ?? 0) === 1
        ? [action as CheckoutAction]
        : []
    );
    const offerings: RawOffering[] = (
      this.fixture[selectors.package] ?? []
    ).map(({ text, attributes }) => {
      const kind = attributes?.["data-kind"];
      if (kind === "product") return { kind, name: text ?? "" };
      if (kind !== "class_package") throw new Error("invalid offering fixture");
      const remaining = Number(attributes?.["data-remaining"]);
      const active = attributes?.["data-active"];
      if (
        !Number.isFinite(remaining) ||
        (active !== "true" && active !== "false")
      ) {
        throw new Error("invalid offering fixture");
      }
      return { kind, name: text ?? "", remaining, active: active === "true" };
    });
    return {
      authenticated: (this.fixture[selectors.authenticated]?.length ?? 0) === 1,
      login_required:
        (this.fixture[selectors.loginRequired]?.length ?? 0) === 1,
      classes,
      actions,
      offerings
    };
  }

  async count(selector: string): Promise<number> {
    this.operations.push(`count:${selector}`);
    return this.fixture[selector as keyof CheckoutFixture]?.length ?? 0;
  }

  async texts(selector: string): Promise<readonly string[]> {
    this.operations.push(`texts:${selector}`);
    return (this.fixture[selector as keyof CheckoutFixture] ?? []).map(
      ({ text }) => text ?? ""
    );
  }

  async attributes(
    selector: string,
    name: string
  ): Promise<readonly (string | null)[]> {
    this.operations.push(`attributes:${selector}:${name}`);
    return (this.fixture[selector as keyof CheckoutFixture] ?? []).map(
      ({ attributes }) => attributes?.[name] ?? null
    );
  }

  async elements(
    selector: string,
    names: readonly string[]
  ): Promise<
    readonly Readonly<{
      text: string;
      attributes: Readonly<Record<string, string | null>>;
    }>[]
  > {
    this.operations.push(`elements:${selector}:${names.join(",")}`);
    return (this.fixture[selector as keyof CheckoutFixture] ?? []).map(
      ({ text, attributes }) => ({
        text: text ?? "",
        attributes: Object.fromEntries(
          names.map((name) => [name, attributes?.[name] ?? null])
        )
      })
    );
  }

  async classes(): Promise<readonly ObservedClass[]> {
    this.operations.push("classes");
    return this.classesFromFixture();
  }

  private async classesFromFixture(): Promise<readonly ObservedClass[]> {
    const fields = [
      this.fixture[selectors.className] ?? [],
      this.fixture[selectors.instructor] ?? [],
      this.fixture[selectors.classDate] ?? [],
      this.fixture[selectors.startTime] ?? [],
      this.fixture[selectors.endTime] ?? [],
      this.fixture[selectors.timezone] ?? []
    ];
    const length = fields[0]!.length;
    if (!fields.every((values) => values.length === length)) {
      throw new Error("incomplete class fixture");
    }
    return Array.from({ length }, (_, index) => ({
      name: fields[0]![index]?.text ?? "",
      instructor: fields[1]![index]?.text ?? "",
      date: fields[2]![index]?.text ?? "",
      start_time: fields[3]![index]?.text ?? "",
      end_time: fields[4]![index]?.text ?? "",
      timezone: fields[5]![index]?.text ?? ""
    }));
  }
}
