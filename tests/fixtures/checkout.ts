import type { CheckoutPageReader } from "../../src/checkout-reader.js";

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
}
