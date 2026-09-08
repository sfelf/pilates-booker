import { readFile, writeFile } from "node:fs/promises";
import { URL } from "node:url";
import { chromium } from "playwright";
import {
  BookingCheckoutNotSelectedError,
  createBookingBrowser as createRealBookingBrowser
} from "../../dist/booking-page.js?built-e2e-real";

export { BookingCheckoutNotSelectedError };

const fixturePath = process.env.PILATES_BOOKER_E2E_FIXTURE;
if (fixturePath === undefined)
  throw new Error("PILATES_BOOKER_E2E_FIXTURE is required");

function instrumentCheckout(html, failure, classId) {
  const script = `<script>
    for (const key of ["myselfSelections", "injuryFills", "packageSelections", "cancellationAcceptances", "submissions"]) document.body.dataset[key] = "0";
    const increment = (key) => document.body.dataset[key] = String(Number(document.body.dataset[key]) + 1);
    document.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (target.name === "reserveFor" && target.checked) increment("myselfSelections");
      if (target.name === "package" && target.checked) increment("packageSelections");
      if (target.type === "checkbox" && target.checked) increment("cancellationAcceptances");
    });
    document.addEventListener("input", (event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement && target.id.startsWith("injuries-")) increment("injuryFills");
    });
    document.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const action = target.closest('[data-testid="action-book"], [data-testid="action-waitlist"]');
      if (action === null) return;
      increment("submissions");
      if (${JSON.stringify(failure)} === "post_submit") {
        document.querySelector('[data-testid="confirmation-booked"]')?.removeAttribute("hidden");
        document.querySelector('[data-testid="confirmation-waitlisted"]')?.removeAttribute("hidden");
      } else {
        const selector = action.matches('[data-testid="action-book"]') ? '[data-testid="confirmation-booked"]' : '[data-testid="confirmation-waitlisted"]';
        document.querySelector(selector)?.removeAttribute("hidden");
        if (action.matches('[data-testid="action-book"]')) {
          const google = document.createElement("a");
          google.href = ${JSON.stringify(`https://app.arketa.co/api/calendar/google?classId=${classId}`)};
          google.textContent = "Google";
          document.body.append(google);
        }
      }
    });
  </script>`;
  return html.replace("</body>", `${script}</body>`);
}

function instrumentCalendar(html) {
  const script = `<script>
    const preserveCalendarCounters = () => window.name = JSON.stringify({
      weekClicks: Number(document.body.dataset.calendarNavigationClicks ?? 0),
      checkoutClicks: Number(document.body.dataset.calendarCheckoutClicks ?? 0)
    });
    preserveCalendarCounters();
    new MutationObserver(preserveCalendarCounters).observe(document.body, {
      attributes: true,
      attributeFilter: ["data-calendar-navigation-clicks", "data-calendar-checkout-clicks"]
    });
  </script>`;
  return html.replace("</body>", `${script}</body>`);
}

export function createBookingBrowser() {
  const launcher = async () => {
    const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    let calendarNavigations = 0;
    let checkoutNavigations = 0;
    let calendarWeekClicks = 0;
    let calendarCheckoutClicks = 0;

    const captureCalendarCounters = async () => {
      const page = context.pages()[0];
      if (page === undefined) return;
      const preserved = await page.evaluate(() => globalThis.window.name);
      try {
        const parsed = JSON.parse(preserved);
        calendarWeekClicks = Number(parsed.weekClicks ?? 0);
        calendarCheckoutClicks = Number(parsed.checkoutClicks ?? 0);
      } catch {
        calendarWeekClicks = 0;
        calendarCheckoutClicks = 0;
      }
    };

    await context.route("https://app.arketa.co/**", async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.endsWith("/calendar")) {
        calendarNavigations += 1;
        await route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: instrumentCalendar(fixture.calendar_html)
        });
        return;
      }
      if (pathname.includes("/calendar/checkout/")) {
        checkoutNavigations += 1;
        if (fixture.failure === "pre_submission") {
          await route.fulfill({
            contentType: "text/html; charset=utf-8",
            body: "<!doctype html><html><body>Not ready</body></html>"
          });
          return;
        }
        if (
          fixture.failure === "checkout_redirect" &&
          pathname.endsWith("/discovery-e2e")
        ) {
          await route.fulfill({
            status: 302,
            headers: {
              location:
                "https://app.arketa.co/iframe/synthetic-studio/calendar/checkout/redirected"
            }
          });
          return;
        }
        await route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: instrumentCheckout(
            fixture.checkout_html ?? fixture.html,
            fixture.failure,
            pathname.split("/").at(-1)
          )
        });
        return;
      }
      await route.abort();
    });

    return {
      pages: () => context.pages(),
      newPage: () => context.newPage(),
      close: async () => {
        const page = context.pages()[0];
        await captureCalendarCounters();
        const count = async (selector) =>
          page === undefined ? 0 : page.locator(selector).count();
        const checked = async (selector) =>
          (await count(selector)) === 1
            ? page.locator(selector).isChecked()
            : false;
        const value = async (selector) =>
          (await count(selector)) === 1
            ? page.locator(selector).inputValue()
            : "";
        const dataCount = async (key) =>
          page === undefined
            ? 0
            : Number(
                (await page.locator("body").getAttribute(`data-${key}`)) ?? 0
              );
        const observation = {
          myself_selected: await checked('input[name="reserveFor"]'),
          injuries_value: await value('input[id^="injuries-"]'),
          selected_package_rows:
            page === undefined
              ? []
              : await page
                  .locator('[data-testid="offering"]')
                  .evaluateAll((offerings) =>
                    offerings.flatMap((offering, row) =>
                      offering.querySelector('input[type="radio"]:checked') ===
                      null
                        ? []
                        : [row]
                    )
                  ),
          cancellation_accepted: await checked('input[id^="cancellation-"]'),
          submissions: await dataCount("submissions"),
          ...(fixture.calendar_html === undefined
            ? {}
            : {
                browser_contexts: 1,
                pages: context.pages().length,
                calendar_navigations: calendarNavigations,
                checkout_navigations: checkoutNavigations,
                calendar_week_clicks: calendarWeekClicks,
                calendar_checkout_clicks: calendarCheckoutClicks,
                myself_selections: await dataCount("myself-selections"),
                injury_fills: await dataCount("injury-fills"),
                package_selections: await dataCount("package-selections"),
                cancellation_acceptances: await dataCount(
                  "cancellation-acceptances"
                )
              })
        };
        await writeFile(
          fixture.observation_path,
          `${JSON.stringify(observation)}\n`,
          "utf8"
        );
        await context.close();
        await browser.close();
      }
    };
  };
  return createRealBookingBrowser(launcher, { readinessTimeoutMs: 1_000 });
}
