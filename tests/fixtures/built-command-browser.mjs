import { readFile, writeFile } from "node:fs/promises";

import { chromium } from "playwright";

import { createBookingPage } from "../../dist/booking-page.js?built-e2e-real";

const fixturePath = process.env.PILATES_BOOKER_E2E_FIXTURE;
if (fixturePath === undefined) {
  throw new Error("PILATES_BOOKER_E2E_FIXTURE is required");
}

export function createBookingBrowser() {
  return async (_profileDir, _checkoutUrl, use) => {
    const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    let submissions = 0;
    try {
      await page.setContent(fixture.html);
      const bookingPage = createBookingPage(page);
      return await use({
        ...bookingPage,
        submit: async (action) => {
          submissions += 1;
          await bookingPage.submit(action);
          const selector =
            action === "book"
              ? '[data-testid="confirmation-booked"]'
              : '[data-testid="confirmation-waitlisted"]';
          await page
            .locator(selector)
            .evaluate((element) => element.removeAttribute("hidden"));
        }
      });
    } finally {
      const observation = {
        myself_selected: await page
          .getByLabel("Myself", { exact: true })
          .isChecked(),
        injuries_value: await page
          .getByLabel(/^Do you have any injuries\?/u)
          .inputValue(),
        selected_package_rows: await page
          .locator('[data-testid="offering"]')
          .evaluateAll((offerings) =>
            offerings.flatMap((offering, row) =>
              offering.querySelector('input[type="radio"]:checked') === null
                ? []
                : [row]
            )
          ),
        cancellation_accepted: await page
          .getByLabel("I agree to the Cancellation Policy", { exact: true })
          .isChecked(),
        submissions
      };
      await writeFile(
        fixture.observation_path,
        `${JSON.stringify(observation)}\n`,
        "utf8"
      );
      await page.close();
      await browser.close();
    }
  };
}
