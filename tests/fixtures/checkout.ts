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
