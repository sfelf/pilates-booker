import { describe, expect, it } from "vitest";

import type { BookingRequest } from "../src/contracts.js";
import {
  runDryInspection,
  type DryRunBrowser,
  type DryRunPage
} from "../src/dry-run.js";
import {
  bookingFixture,
  FixtureCheckoutPage,
  selectors,
  type CheckoutFixture
} from "./fixtures/checkout.js";

const request: BookingRequest & Readonly<{ dry_run: true }> = {
  schema_version: 1,
  request_id: "123e4567-e89b-42d3-a456-426614174000",
  booking_url:
    "https://app.arketa.co/iframe/example/calendar/checkout/FAKE_CHECKOUT_ID",
  expected_class: {
    name: "Reformer – Début ✨",
    date: "2026-09-01",
    start_time: "09:30",
    timezone: "America/Los_Angeles"
  },
  reserve_for: "myself",
  permitted_actions: ["book", "waitlist"],
  policy_version: "2026-08-27",
  allow_monetary_charge: false,
  dry_run: true
};

class FixtureDryRunPage implements DryRunPage {
  private readonly reader: FixtureCheckoutPage;
  private urlIndex = 0;
  private ready: boolean;

  constructor(
    fixture: CheckoutFixture,
    private readonly urls: readonly string[] = [request.booking_url],
    hydrateOnWait = false
  ) {
    this.reader = new FixtureCheckoutPage(fixture);
    this.ready = !hydrateOnWait;
  }

  async navigate(url: string): Promise<void> {
    if (url !== request.booking_url) throw new Error("wrong navigation");
  }

  currentUrl(): string {
    const url = this.urls[Math.min(this.urlIndex, this.urls.length - 1)]!;
    this.urlIndex += 1;
    return url;
  }

  async waitUntilReady(): Promise<void> {
    this.ready = true;
  }

  snapshot(): ReturnType<FixtureCheckoutPage["snapshot"]> {
    if (!this.ready) {
      return Promise.resolve({
        authenticated: false,
        login_required: false,
        classes: [],
        actions: [],
        offerings: []
      });
    }
    return this.reader.snapshot();
  }
}

function browserWith(page: DryRunPage): {
  browser: DryRunBrowser;
  profiles: string[];
} {
  const profiles: string[] = [];
  return {
    profiles,
    browser: async (profileDir, use) => {
      profiles.push(profileDir);
      return use(page);
    }
  };
}

describe("runDryInspection", () => {
  it("returns a read-only checkout observation", async () => {
    const injected = browserWith(new FixtureDryRunPage(bookingFixture()));

    const result = await runDryInspection(
      { request, profileDir: "/tmp/Pilates Profile" },
      injected.browser
    );

    expect(result).toMatchObject({
      status: "observed",
      observation: { status: "observed", action: "book" }
    });
    expect(injected.profiles).toEqual(["/tmp/Pilates Profile"]);
  });

  it("waits for client-rendered checkout readiness before reading", async () => {
    const page = new FixtureDryRunPage(
      bookingFixture(),
      [request.booking_url],
      true
    );

    const result = await runDryInspection(
      { request, profileDir: "/tmp/profile" },
      browserWith(page).browser
    );

    expect(result).toMatchObject({ status: "observed" });
  });

  it("maps login-required to a fixed safe stop", async () => {
    const page = new FixtureDryRunPage({ [selectors.loginRequired]: [{}] });

    await expect(
      runDryInspection(
        { request, profileDir: "/tmp/profile" },
        browserWith(page).browser
      )
    ).resolves.toEqual({ status: "safe_stop", reason: "LOGIN_REQUIRED" });
  });

  it.each([
    "https://evil.example/checkout/private-value",
    "https://app.arketa.co/iframe/example/calendar/checkout/OTHER_CHECKOUT"
  ])(
    "rejects an unsafe final navigation without exposing %s",
    async (finalUrl) => {
      const result = await runDryInspection(
        { request, profileDir: "/tmp/profile" },
        browserWith(new FixtureDryRunPage(bookingFixture(), [finalUrl])).browser
      );

      expect(result).toEqual({
        status: "technical_failure",
        reason: "UNSAFE_NAVIGATION"
      });
      expect(JSON.stringify(result)).not.toContain(finalUrl);
    }
  );

  it("rechecks navigation after reading the page", async () => {
    const unsafe = "https://evil.example/after-read";
    const page = new FixtureDryRunPage(bookingFixture(), [
      request.booking_url,
      unsafe
    ]);

    const result = await runDryInspection(
      { request, profileDir: "/tmp/profile" },
      browserWith(page).browser
    );

    expect(result).toEqual({
      status: "technical_failure",
      reason: "UNSAFE_NAVIGATION"
    });
    expect(JSON.stringify(result)).not.toContain(unsafe);
  });

  it("maps contradictory page state to a fixed failure", async () => {
    const fixture = {
      ...bookingFixture(),
      [selectors.waitlist]: [{}]
    };

    await expect(
      runDryInspection(
        { request, profileDir: "/tmp/profile" },
        browserWith(new FixtureDryRunPage(fixture)).browser
      )
    ).resolves.toEqual({
      status: "technical_failure",
      reason: "AMBIGUOUS_CHECKOUT"
    });
  });

  it("maps browser and reader failures without returning their messages", async () => {
    const browser: DryRunBrowser = async () => {
      throw new Error("cookie=private-session-value");
    };

    const result = await runDryInspection(
      { request, profileDir: "/tmp/profile" },
      browser
    );

    expect(result).toEqual({
      status: "technical_failure",
      reason: "INSPECTION_FAILED"
    });
    expect(JSON.stringify(result)).not.toContain("private-session-value");
  });
});
