import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createBookingBrowser,
  createBookingPage,
  type BookingPage,
  type BookingPageState
} from "../src/booking-page.js";
import type {
  BrowserContextLike,
  PersistentBrowserLauncher
} from "../src/browser-session.js";
import type { ExpectedClass } from "../src/contracts.js";
import { bookingPageHtml } from "./fixtures/checkout.js";

const expectedClass: ExpectedClass = {
  name: "Reformer – Début ✨",
  date: "2026-09-01",
  start_time: "09:30",
  timezone: "America/Los_Angeles"
};

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser.close();
});

async function syntheticPage(html = bookingPageHtml()): Promise<Page> {
  const page = await browser.newPage();
  await page.setContent(html);
  return page;
}

describe("BookingPage read boundary", () => {
  it("inherits disabled state for package and submission controls", async () => {
    const page = await syntheticPage();
    await page
      .locator('[data-testid="offering"]')
      .first()
      .evaluate((offering) => offering.setAttribute("aria-disabled", "true"));
    await page
      .getByRole("button", { name: "Book", exact: true })
      .evaluate((button) => {
        const wrapper = document.createElement("div");
        wrapper.setAttribute("aria-disabled", "true");
        button.replaceWith(wrapper);
        wrapper.append(button);
      });

    const state = await createBookingPage(page, expectedClass).read();

    expect(state.packages[0]?.control.enabled).toBe(false);
    expect(state.submission.book.enabled).toBe(false);
    await page.close();
  });

  it("returns one coherent supported state without projecting attendee identity or injury text", async () => {
    const page = await syntheticPage();

    const state = await createBookingPage(page, expectedClass).read();

    expect(state).toEqual<BookingPageState>({
      observation: {
        status: "observed",
        observed_class: {
          name: "Reformer – Début ✨",
          instructor: "Ana O’Neil",
          date: "2026-09-01",
          start_time: "09:30",
          end_time: "10:20",
          timezone: "America/Los_Angeles"
        },
        action: "book",
        packages: [
          {
            name: "Studio / 10-Class Pack",
            remaining: 3,
            approved: false
          },
          {
            name: "Intro / 5-Class Pack",
            remaining: 1,
            approved: false
          }
        ]
      },
      myself: { visibleCount: 1, selected: true, enabled: true },
      injuries: { visibleCount: 1, value: "PRESENT", enabled: true },
      packages: [
        {
          row: 0,
          name: "Studio / 10-Class Pack",
          remaining: 3,
          active: true,
          product: false,
          control: { visibleCount: 1, selected: true, enabled: true }
        },
        {
          row: 1,
          name: "Intro / 5-Class Pack",
          remaining: 1,
          active: true,
          product: false,
          control: { visibleCount: 1, selected: false, enabled: true }
        },
        {
          row: 2,
          name: "Grip Socks — Édition limitée",
          remaining: 0,
          active: false,
          product: true,
          control: { visibleCount: 0, selected: false, enabled: false }
        }
      ],
      selectedPackageRow: 0,
      cancellation: { visibleCount: 1, accepted: false, enabled: true },
      submission: {
        book: { visibleCount: 1, enabled: true },
        waitlist: { visibleCount: 0, enabled: false }
      },
      confirmation: { bookedVisibleCount: 0, waitlistedVisibleCount: 0 }
    });
    const diagnostic = JSON.stringify(state);
    expect(diagnostic).not.toContain("synthetic-private@example.test");
    expect(diagnostic).not.toContain("Synthetic existing answer");
    await page.close();
  });

  it("accepts a product offer without package-only metadata", async () => {
    const page = await syntheticPage();

    const state = await createBookingPage(page, expectedClass).read();

    expect(state.packages.at(-1)).toEqual({
      row: 2,
      name: "Grip Socks — Édition limitée",
      remaining: 0,
      active: false,
      product: true,
      control: { visibleCount: 0, selected: false, enabled: false }
    });
    expect(state.observation.packages).not.toContainEqual(
      expect.objectContaining({ name: "Grip Socks — Édition limitée" })
    );
    await page.close();
  });

  it("derives dry-run action availability from the real accessible button name", async () => {
    const page = await syntheticPage();
    await page.locator("body").evaluate((body) => {
      const label = document.createElement("span");
      label.id = "dry-run-action-label";
      label.textContent = "Different action";
      body.append(label);
      document
        .querySelector('[data-testid="action-book"]')
        ?.setAttribute("aria-labelledby", label.id);
    });
    const booking = createBookingPage(page, expectedClass);

    const state = await booking.read();

    expect(state.submission.book).toEqual({
      visibleCount: 0,
      enabled: false
    });
    await page.close();
  });

  it("binds action availability and submission to the marked button", async () => {
    const page = await syntheticPage();
    await page.locator('[data-testid="action-book"]').evaluate((element) => {
      element.outerHTML = '<div data-testid="action-book">Book</div>';
      const unrelated = document.createElement("button");
      unrelated.textContent = "Book";
      unrelated.dataset.testid = "unrelated-book";
      unrelated.addEventListener("click", () => {
        unrelated.dataset.clicked = "true";
      });
      document.body.append(unrelated);
    });
    const booking = createBookingPage(page, expectedClass);

    const state = await booking.read();

    expect(state.observation.action).toBe("book");
    expect(state.submission.book).toEqual({
      visibleCount: 0,
      enabled: false
    });
    await expect(booking.submit("book")).rejects.toThrow(
      "Booking page control is unavailable."
    );
    expect(
      await page
        .locator('[data-testid="unrelated-book"]')
        .getAttribute("data-clicked")
    ).toBeNull();
    await page.close();
  });

  it.each([
    ["Myself radios", { myselfCount: 2 }],
    ["injuries fields", { injuries: ["", ""] }],
    ["package controls", { packageControlCounts: [2, 1, 0] }],
    ["cancellation controls", { cancellationCount: 2 }]
  ] as const)("rejects duplicate visible %s", async (_name, options) => {
    const page = await syntheticPage(bookingPageHtml(options));

    await expect(createBookingPage(page, expectedClass).read()).rejects.toThrow(
      "Booking page could not be read."
    );
    await page.close();
  });

  it("rejects contradictory actionable and existing-enrollment markers", async () => {
    const page = await syntheticPage(
      bookingPageHtml({ action: "book_and_already_booked" })
    );

    await expect(createBookingPage(page, expectedClass).read()).rejects.toThrow(
      "Booking page could not be read."
    );
    await page.close();
  });

  it("excludes wrong input types from the supported injuries and cancellation controls", async () => {
    const page = await syntheticPage(
      bookingPageHtml({
        injuriesType: "checkbox",
        cancellationType: "text"
      })
    );
    const booking = createBookingPage(page, expectedClass);

    const state = await booking.read();

    expect(state.injuries).toEqual({
      visibleCount: 0,
      value: "",
      enabled: false
    });
    expect(state.cancellation).toEqual({
      visibleCount: 0,
      accepted: false,
      enabled: false
    });
    await expect(booking.fillInjuriesIfEmpty("None")).rejects.toThrow(
      "Booking page control is unavailable."
    );
    await expect(booking.acceptCancellationPolicy()).rejects.toThrow(
      "Booking page control is unavailable."
    );
    await page.close();
  });

  it("uses the effective accessible name instead of a conflicting associated label", async () => {
    const privateLabel = "Synthetic conflicting private label";
    const page = await syntheticPage(
      bookingPageHtml({
        injuriesAriaLabel: privateLabel,
        cancellationAriaLabel: privateLabel
      })
    );
    const booking = createBookingPage(page, expectedClass);

    const state = await booking.read();

    expect(state.injuries.visibleCount).toBe(0);
    expect(state.cancellation.visibleCount).toBe(0);
    let injuryError: unknown;
    let cancellationError: unknown;
    try {
      await booking.fillInjuriesIfEmpty("None");
    } catch (error) {
      injuryError = error;
    }
    try {
      await booking.acceptCancellationPolicy();
    } catch (error) {
      cancellationError = error;
    }
    expect(String(injuryError)).toContain(
      "Booking page control is unavailable."
    );
    expect(String(cancellationError)).toContain(
      "Booking page control is unavailable."
    );
    expect(String(injuryError)).not.toContain(privateLabel);
    expect(String(cancellationError)).not.toContain(privateLabel);
    await page.close();
  });

  it("reads only the exact accessible-name Myself radio from the reserveFor group", async () => {
    const page = await syntheticPage();
    await page.locator("body").evaluate((body) => {
      const label = document.createElement("label");
      label.htmlFor = "reserve-someone-else";
      label.textContent = "Someone Else";
      const input = document.createElement("input");
      input.id = "reserve-someone-else";
      input.type = "radio";
      input.name = "reserveFor";
      body.append(label, input);
    });

    const state = await createBookingPage(page, expectedClass).read();

    expect(state.myself).toEqual({
      visibleCount: 1,
      selected: true,
      enabled: true
    });
    await page.close();
  });

  it.each([
    "class-name",
    "instructor",
    "class-date",
    "start-time",
    "end-time",
    "timezone"
  ])(
    "rejects duplicate visible %s metadata without projection",
    async (testId) => {
      const privateValue = `synthetic-private-${testId}`;
      const page = await syntheticPage();
      await page.locator('[data-testid="class"]').evaluate(
        (container, value) => {
          const duplicate = document.createElement("span");
          duplicate.dataset.testid = value.testId;
          duplicate.textContent = value.privateValue;
          container.append(duplicate);
        },
        { testId, privateValue }
      );

      let error: unknown;
      try {
        await createBookingPage(page, expectedClass).read();
      } catch (caught) {
        error = caught;
      }

      expect(String(error)).toContain("Booking page could not be read.");
      expect(String(error)).not.toContain(privateValue);
      await page.close();
    }
  );
});

describe("BookingPage mutation boundary", () => {
  it("refuses package selection and submission inside disabled ancestors", async () => {
    const page = await syntheticPage();
    await page
      .locator('[data-testid="offering"]')
      .first()
      .evaluate((offering) => offering.setAttribute("aria-disabled", "true"));
    await page
      .getByRole("button", { name: "Book", exact: true })
      .evaluate((button) => {
        const wrapper = document.createElement("div");
        wrapper.setAttribute("aria-disabled", "true");
        button.replaceWith(wrapper);
        wrapper.append(button);
      });
    const booking = createBookingPage(page, expectedClass);

    await expect(booking.selectPackage(0)).rejects.toThrow(
      "Booking page control is unavailable."
    );
    await expect(booking.submit("book")).rejects.toThrow(
      "Booking page control is unavailable."
    );
    expect(
      await page.locator('input[name="package"]').first().isChecked()
    ).toBe(true);
    await page.close();
  });

  it("does not mutate an excluded email textbox with the injuries name", async () => {
    const page = await syntheticPage(
      bookingPageHtml({ injuries: [""], injuriesType: "email" })
    );
    const booking = createBookingPage(page, expectedClass);
    const state = await booking.read();

    expect(state.injuries.visibleCount).toBe(0);
    await expect(booking.fillInjuriesIfEmpty("None")).rejects.toThrow(
      "Booking page control is unavailable."
    );
    expect(await page.locator('input[id^="injuries-"]').inputValue()).toBe("");
    await page.close();
  });

  it("does not mutate an excluded custom ARIA cancellation checkbox", async () => {
    const page = await syntheticPage(bookingPageHtml({ cancellationCount: 0 }));
    await page.locator("body").evaluate((body) => {
      const checkbox = document.createElement("button");
      checkbox.type = "button";
      checkbox.setAttribute("role", "checkbox");
      checkbox.setAttribute("aria-label", "I agree to the Cancellation Policy");
      checkbox.setAttribute("aria-checked", "false");
      checkbox.addEventListener("click", () => {
        checkbox.setAttribute("aria-checked", "true");
        checkbox.setAttribute("data-mutated", "true");
      });
      body.append(checkbox);
    });
    const booking = createBookingPage(page, expectedClass);
    const state = await booking.read();

    expect(state.cancellation.visibleCount).toBe(0);
    await expect(booking.acceptCancellationPolicy()).rejects.toThrow(
      "Booking page control is unavailable."
    );
    const custom = page.getByRole("checkbox", {
      name: "I agree to the Cancellation Policy",
      exact: true
    });
    expect(await custom.getAttribute("aria-checked")).toBe("false");
    expect(await custom.getAttribute("data-mutated")).toBeNull();
    await page.close();
  });

  it("selects only the supported Myself radio", async () => {
    const page = await syntheticPage(
      bookingPageHtml({ myselfSelected: false })
    );
    const booking = createBookingPage(page, expectedClass);

    await expect(booking.selectMyself()).resolves.toBeUndefined();

    expect(await page.locator('input[name="reserveFor"]').isChecked()).toBe(
      true
    );
    expect(
      await page.locator('input[name="package"]').first().isChecked()
    ).toBe(true);
    expect(
      await page
        .getByLabel("I agree to the Cancellation Policy", { exact: true })
        .isChecked()
    ).toBe(false);
    expect(await page.locator('input[id^="injuries-"]').inputValue()).toBe(
      "Synthetic existing answer"
    );
    expect(await page.getByLabel("Receive studio updates").isChecked()).toBe(
      false
    );
    await page.close();
  });

  it("selects the exact accessible-name Myself radio, not another reserveFor choice", async () => {
    const page = await syntheticPage(
      bookingPageHtml({ myselfSelected: false })
    );
    await page.locator("body").evaluate((body) => {
      const label = document.createElement("label");
      label.htmlFor = "reserve-someone-else";
      label.textContent = "Someone Else";
      const input = document.createElement("input");
      input.id = "reserve-someone-else";
      input.type = "radio";
      input.name = "reserveFor";
      body.append(label, input);
    });
    const booking = createBookingPage(page, expectedClass);

    await expect(booking.selectMyself()).resolves.toBeUndefined();

    expect(await page.getByLabel("Myself", { exact: true }).isChecked()).toBe(
      true
    );
    expect(
      await page.getByLabel("Someone Else", { exact: true }).isChecked()
    ).toBe(false);
    await page.close();
  });

  it.each([
    ["missing", 0],
    ["duplicate", 2]
  ] as const)(
    "fails closed for %s exact Myself radios",
    async (_name, count) => {
      const page = await syntheticPage(
        bookingPageHtml({ myselfCount: count, myselfSelected: false })
      );
      if (count === 0) {
        await page.locator("body").evaluate((body) => {
          const label = document.createElement("label");
          label.htmlFor = "reserve-someone-else";
          label.textContent = "Someone Else";
          const input = document.createElement("input");
          input.id = "reserve-someone-else";
          input.type = "radio";
          input.name = "reserveFor";
          body.append(label, input);
        });
      }
      const booking = createBookingPage(page, expectedClass);

      await expect(booking.selectMyself()).rejects.toThrow(
        "Booking page control is unavailable."
      );
      expect(
        await page.locator('input[name="reserveFor"]:checked').count()
      ).toBe(0);
      await page.close();
    }
  );

  it.each([
    ["required-marker label", true],
    ["starless label", false]
  ])(
    "fills an empty injuries field through the exact %s",
    async (_name, marker) => {
      const page = await syntheticPage(
        bookingPageHtml({
          injuries: ["   "],
          injuriesRequiredMarker: marker
        })
      );
      const booking = createBookingPage(page, expectedClass);

      await expect(
        booking.fillInjuriesIfEmpty("None")
      ).resolves.toBeUndefined();

      expect(await page.locator('input[id^="injuries-"]').inputValue()).toBe(
        "None"
      );
      await page.close();
    }
  );

  it("preserves a non-empty injuries answer without returning or projecting it", async () => {
    const page = await syntheticPage();
    const booking = createBookingPage(page, expectedClass);

    const result = await booking.fillInjuriesIfEmpty("None");

    expect(result).toBeUndefined();
    expect(await page.locator('input[id^="injuries-"]').inputValue()).toBe(
      "Synthetic existing answer"
    );
    expect(JSON.stringify(await booking.read())).not.toContain(
      "Synthetic existing answer"
    );
    await page.close();
  });

  it("selects only the requested package row", async () => {
    const page = await syntheticPage();
    const booking = createBookingPage(page, expectedClass);

    await expect(booking.selectPackage(1)).resolves.toBeUndefined();

    const packageControls = page.locator('input[name="package"]');
    expect(await packageControls.nth(0).isChecked()).toBe(false);
    expect(await packageControls.nth(1).isChecked()).toBe(true);
    expect(await page.locator('input[name="reserveFor"]').isChecked()).toBe(
      true
    );
    await page.close();
  });

  it("accepts only the exact cancellation policy control", async () => {
    const page = await syntheticPage();
    const booking = createBookingPage(page, expectedClass);

    await expect(booking.acceptCancellationPolicy()).resolves.toBeUndefined();

    expect(
      await page
        .getByLabel("I agree to the Cancellation Policy", { exact: true })
        .isChecked()
    ).toBe(true);
    expect(await page.getByLabel("Receive studio updates").isChecked()).toBe(
      false
    );
    await page.close();
  });

  it.each([
    ["book", "Book"],
    ["waitlist", "Join the waitlist"]
  ] as const)(
    "submits the exact %s action once",
    async (action, buttonName) => {
      const page = await syntheticPage(bookingPageHtml({ action }));
      const button = page.getByRole("button", {
        name: buttonName,
        exact: true
      });
      await button.evaluate((element) => {
        element.addEventListener("click", () => {
          const clicks = Number(element.getAttribute("data-clicks") ?? "0");
          element.setAttribute("data-clicks", String(clicks + 1));
        });
      });

      await expect(
        createBookingPage(page, expectedClass).submit(action)
      ).resolves.toBeUndefined();

      expect(await button.getAttribute("data-clicks")).toBe("1");
      await page.close();
    }
  );

  it("fails closed instead of clicking a different action", async () => {
    const page = await syntheticPage(bookingPageHtml({ action: "book" }));
    const book = page.getByRole("button", { name: "Book", exact: true });
    await book.evaluate((element) => {
      element.addEventListener("click", () =>
        element.setAttribute("data-clicked", "true")
      );
    });

    await expect(
      createBookingPage(page, expectedClass).submit("waitlist")
    ).rejects.toThrow("Booking page control is unavailable.");
    expect(await book.getAttribute("data-clicked")).toBeNull();
    await page.close();
  });
});

async function revealConfirmation(
  page: Page,
  testId: "confirmation-booked" | "confirmation-waitlisted"
): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
  await page.locator(`[data-testid="${testId}"]`).evaluateAll((elements) => {
    for (const element of elements) {
      (element as HTMLElement).hidden = false;
    }
  });
}

describe("BookingPage confirmation boundary", () => {
  it.each([
    ["book", "confirmation-booked", "BOOKED"],
    ["waitlist", "confirmation-waitlisted", "WAITLISTED"]
  ] as const)(
    "returns the exact singleton %s confirmation",
    async (action, testId, expected) => {
      const page = await syntheticPage(bookingPageHtml({ action }));
      const booking = createBookingPage(page, expectedClass, {
        confirmationTimeoutMs: 200
      });
      await booking.read();
      await booking.submit(action);
      const reveal = revealConfirmation(page, testId);

      await expect(booking.waitForConfirmation(action)).resolves.toBe(expected);
      await reveal;
      await page.close();
    }
  );

  it("returns unknown when only the wrong-action confirmation appears", async () => {
    const page = await syntheticPage(bookingPageHtml({ action: "book" }));
    const booking = createBookingPage(page, expectedClass, {
      confirmationTimeoutMs: 200
    });
    await booking.read();
    await booking.submit("book");
    const reveal = revealConfirmation(page, "confirmation-waitlisted");

    await expect(booking.waitForConfirmation("book")).resolves.toBe("UNKNOWN");
    await reveal;
    await page.close();
  });

  it("returns unknown for simultaneous booking and waitlist evidence", async () => {
    const page = await syntheticPage();
    const booking = createBookingPage(page, expectedClass, {
      confirmationTimeoutMs: 200
    });
    await booking.read();
    await booking.submit("book");
    const reveal = Promise.all([
      revealConfirmation(page, "confirmation-booked"),
      revealConfirmation(page, "confirmation-waitlisted")
    ]);

    await expect(booking.waitForConfirmation("book")).resolves.toBe("UNKNOWN");
    await reveal;
    await page.close();
  });

  it("returns unknown for duplicate matching confirmation evidence", async () => {
    const page = await syntheticPage(
      bookingPageHtml({ bookedConfirmations: 2 })
    );
    const booking = createBookingPage(page, expectedClass, {
      confirmationTimeoutMs: 200
    });
    await booking.read();
    await booking.submit("book");
    const reveal = revealConfirmation(page, "confirmation-booked");

    await expect(booking.waitForConfirmation("book")).resolves.toBe("UNKNOWN");
    await reveal;
    await page.close();
  });

  it("returns unknown when no exact confirmation appears before timeout", async () => {
    const page = await syntheticPage();
    await page.locator("body").evaluate((body) => {
      const nearMatch = document.createElement("div");
      nearMatch.textContent = "You are Booked! Details";
      body.append(nearMatch);
    });
    const booking = createBookingPage(page, expectedClass, {
      confirmationTimeoutMs: 30
    });
    await booking.read();
    await booking.submit("book");

    await expect(booking.waitForConfirmation("book")).resolves.toBe("UNKNOWN");
    await page.close();
  });

  it("returns unknown when navigation interrupts confirmation polling", async () => {
    const page = await syntheticPage();
    const booking = createBookingPage(page, expectedClass, {
      confirmationTimeoutMs: 200
    });
    await booking.read();
    await booking.submit("book");
    const navigation = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      await page.goto("data:text/html,<p>synthetic navigation</p>");
    })();

    await expect(booking.waitForConfirmation("book")).resolves.toBe("UNKNOWN");
    await navigation;
    await page.close();
  });

  it("returns unknown when navigation completes inside submission before polling begins", async () => {
    const page = await syntheticPage();
    const booking = createBookingPage(page, expectedClass, {
      confirmationTimeoutMs: 100
    });
    await booking.read();
    await page
      .getByRole("button", { name: "Book", exact: true })
      .evaluate((button) => {
        button.addEventListener("click", () => {
          window.history.pushState({}, "", "#submitted");
          const confirmation = document.querySelector(
            '[data-testid="confirmation-booked"]'
          );
          if (confirmation instanceof HTMLElement) {
            confirmation.hidden = false;
          }
        });
      });

    await booking.submit("book");

    expect(page.url()).toContain("#submitted");
    await expect(booking.waitForConfirmation("book")).resolves.toBe("UNKNOWN");
    await page.close();
  });
});

const checkoutUrl =
  "https://app.arketa.co/iframe/example/calendar/checkout/FAKE_CHECKOUT_ID";

type ReadinessWait = (options: {
  state: "visible";
  timeout: number;
}) => Promise<void>;

function lifecycleHarness(
  finalUrl: string | (() => string) = checkoutUrl,
  readinessWait: ReadinessWait = async () => undefined
): {
  launcher: PersistentBrowserLauncher;
  navigations: unknown[];
  callbacks: BookingPage[];
  launches: string[];
  closeCount(): number;
} {
  const navigations: unknown[] = [];
  const callbacks: BookingPage[] = [];
  const launches: string[] = [];
  let closes = 0;
  const page = {
    goto: async (...args: unknown[]) => {
      navigations.push(args);
    },
    url: () => (typeof finalUrl === "string" ? finalUrl : finalUrl()),
    locator: () => {
      const readinessLocator = {
        filter: () => readinessLocator,
        first: () => ({ waitFor: readinessWait })
      };
      return readinessLocator;
    }
  } as unknown as Page;
  const context: BrowserContextLike = {
    pages: () => [page],
    newPage: async () => page,
    close: async () => {
      closes += 1;
    }
  };
  const launcher: PersistentBrowserLauncher = async (profileDir) => {
    launches.push(profileDir);
    return context;
  };
  return {
    launcher,
    navigations,
    callbacks,
    launches,
    closeCount: () => closes
  };
}

describe("BookingBrowser lifecycle", () => {
  it("accepts a visible supported marker after a hidden first DOM match", async () => {
    const realPage = await syntheticPage(`<!doctype html>
      <html><body>
        <div data-testid="authenticated" hidden>Hidden authenticated marker</div>
        <div data-testid="login-required">Visible login marker</div>
      </body></html>`);
    const page = new Proxy(realPage, {
      get(target, property) {
        if (property === "goto") return async () => undefined;
        if (property === "url") return () => checkoutUrl;
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
    let closes = 0;
    const context: BrowserContextLike = {
      pages: () => [page],
      newPage: async () => page,
      close: async () => {
        closes += 1;
      }
    };
    const launcher: PersistentBrowserLauncher = async () => context;
    const browserBoundary = createBookingBrowser(expectedClass, launcher, {
      readinessTimeoutMs: 50
    });

    try {
      await expect(
        browserBoundary("/tmp/profile", checkoutUrl, async () => "ready")
      ).resolves.toBe("ready");
      expect(closes).toBe(1);
    } finally {
      await realPage.close();
    }
  });

  it("waits for delayed supported checkout hydration before invoking the callback", async () => {
    let releaseReadiness: (() => void) | undefined;
    let readinessStarted = false;
    let callbackCalled = false;
    const harness = lifecycleHarness(
      checkoutUrl,
      () =>
        new Promise<void>((resolve) => {
          readinessStarted = true;
          releaseReadiness = resolve;
        })
    );
    const browserBoundary = createBookingBrowser(
      expectedClass,
      harness.launcher
    );

    const running = browserBoundary("/tmp/profile", checkoutUrl, async () => {
      callbackCalled = true;
      return "hydrated";
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(readinessStarted).toBe(true);
    expect(callbackCalled).toBe(false);
    releaseReadiness?.();
    await expect(running).resolves.toBe("hydrated");
    expect(harness.closeCount()).toBe(1);
  });

  it("bounds hydration timeout, emits a fixed diagnostic, and closes", async () => {
    const privateFailure = "synthetic-private-hydration-value";
    const harness = lifecycleHarness(
      checkoutUrl,
      ({ timeout }) =>
        new Promise<void>((_resolve, reject) => {
          setTimeout(() => reject(new Error(privateFailure)), timeout);
        })
    );
    const browserBoundary = createBookingBrowser(
      expectedClass,
      harness.launcher,
      { readinessTimeoutMs: 10 }
    );

    let error: unknown;
    try {
      await browserBoundary("/tmp/profile", checkoutUrl, async (page) => {
        harness.callbacks.push(page);
      });
    } catch (caught) {
      error = caught;
    }

    expect(String(error)).toContain("Booking browser readiness failed.");
    expect(String(error)).not.toContain(privateFailure);
    expect(harness.callbacks).toEqual([]);
    expect(harness.closeCount()).toBe(1);
  });

  it("rechecks the checkout URL after hydration before invoking the callback", async () => {
    let currentUrl = checkoutUrl;
    const unsafe = "https://evil.example/private-after-hydration";
    const harness = lifecycleHarness(
      () => currentUrl,
      async () => {
        currentUrl = unsafe;
      }
    );
    const browserBoundary = createBookingBrowser(
      expectedClass,
      harness.launcher
    );

    let error: unknown;
    try {
      await browserBoundary("/tmp/profile", checkoutUrl, async (page) => {
        harness.callbacks.push(page);
      });
    } catch (caught) {
      error = caught;
    }

    expect(String(error)).toContain("Booking browser navigation failed.");
    expect(String(error)).not.toContain(unsafe);
    expect(harness.callbacks).toEqual([]);
    expect(harness.closeCount()).toBe(1);
  });

  it("navigates to the validated checkout, returns callback output, and closes", async () => {
    const harness = lifecycleHarness();
    const browserBoundary = createBookingBrowser(
      expectedClass,
      harness.launcher
    );

    const result = await browserBoundary(
      "/tmp/Pilates Profile",
      checkoutUrl,
      async (page) => {
        harness.callbacks.push(page);
        return "callback-result";
      }
    );

    expect(result).toBe("callback-result");
    expect(harness.launches).toEqual(["/tmp/Pilates Profile"]);
    expect(harness.navigations).toEqual([
      [checkoutUrl, { waitUntil: "domcontentloaded" }]
    ]);
    expect(harness.callbacks).toHaveLength(1);
    expect(harness.closeCount()).toBe(1);
  });

  it("closes when the callback throws while preserving the callback failure", async () => {
    const harness = lifecycleHarness();
    const browserBoundary = createBookingBrowser(
      expectedClass,
      harness.launcher
    );

    await expect(
      browserBoundary("/tmp/profile", checkoutUrl, async () => {
        throw new Error("trusted callback failure");
      })
    ).rejects.toThrow("trusted callback failure");
    expect(harness.closeCount()).toBe(1);
  });

  it("closes and rejects a redirected final URL without projecting it", async () => {
    const unsafe = "https://evil.example/private-identifier";
    const harness = lifecycleHarness(unsafe);
    const browserBoundary = createBookingBrowser(
      expectedClass,
      harness.launcher
    );

    let error: unknown;
    try {
      await browserBoundary("/tmp/profile", checkoutUrl, async () => undefined);
    } catch (caught) {
      error = caught;
    }

    expect(String(error)).toContain("Booking browser navigation failed.");
    expect(String(error)).not.toContain(unsafe);
    expect(harness.closeCount()).toBe(1);
  });

  it("rejects an invalid checkout before opening a profile", async () => {
    const harness = lifecycleHarness();
    const browserBoundary = createBookingBrowser(
      expectedClass,
      harness.launcher
    );

    await expect(
      browserBoundary(
        "/tmp/profile",
        "https://evil.example/private-identifier",
        async () => undefined
      )
    ).rejects.toThrow("Invalid Arketa checkout URL.");
    expect(harness.launches).toEqual([]);
  });
});
