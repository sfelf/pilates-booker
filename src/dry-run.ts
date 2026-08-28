import type { Page } from "playwright";

import { withPersistentBrowser } from "./browser-session.js";
import {
  CheckoutInspectionError,
  inspectCheckoutSnapshot
} from "./checkout-inspection.js";
import {
  CheckoutReadError,
  createPlaywrightCheckoutReader,
  readCheckoutSnapshot,
  type CheckoutPageReader
} from "./checkout-reader.js";
import type { BookingRequest, CheckoutObservation } from "./contracts.js";
import { validateCheckoutUrl } from "./url-policy.js";

export type DryRunPage = CheckoutPageReader &
  Readonly<{
    navigate(url: string): Promise<void>;
    currentUrl(): string;
  }>;

export type DryRunBrowser = <T>(
  profileDir: string,
  use: (page: DryRunPage) => Promise<T>
) => Promise<T>;

export type DryInspectionInput = Readonly<{
  request: BookingRequest & Readonly<{ dry_run: true }>;
  profileDir: string;
}>;

export type DryInspectionResult =
  | Readonly<{
      status: "observed";
      observation: Extract<CheckoutObservation, { status: "observed" }>;
    }>
  | Readonly<{ status: "safe_stop"; reason: "LOGIN_REQUIRED" }>
  | Readonly<{
      status: "technical_failure";
      reason:
        | "UNSAFE_NAVIGATION"
        | "AMBIGUOUS_CHECKOUT"
        | "CLASS_MISMATCH"
        | "INSPECTION_FAILED";
    }>;

const openPersistentDryRunBrowser: DryRunBrowser = (profileDir, use) =>
  withPersistentBrowser(profileDir, async (context) => {
    const page = context.pages()[0] ?? (await context.newPage());
    return use(createDryRunPage(page));
  });

export async function runDryInspection(
  input: DryInspectionInput,
  browser: DryRunBrowser = openPersistentDryRunBrowser
): Promise<DryInspectionResult> {
  try {
    return await browser(input.profileDir, async (page) => {
      await page.navigate(input.request.booking_url);
      if (!isExpectedCheckout(page.currentUrl(), input.request.booking_url)) {
        return technicalFailure("UNSAFE_NAVIGATION");
      }

      let observation: CheckoutObservation;
      try {
        observation = inspectCheckoutSnapshot(
          input.request,
          await readCheckoutSnapshot(page)
        );
      } catch (error) {
        if (error instanceof CheckoutInspectionError) {
          return technicalFailure(
            error.code === "CLASS_MISMATCH"
              ? "CLASS_MISMATCH"
              : "AMBIGUOUS_CHECKOUT"
          );
        }
        if (error instanceof CheckoutReadError) {
          return technicalFailure("AMBIGUOUS_CHECKOUT");
        }
        return technicalFailure("INSPECTION_FAILED");
      }

      if (!isExpectedCheckout(page.currentUrl(), input.request.booking_url)) {
        return technicalFailure("UNSAFE_NAVIGATION");
      }
      if (observation.status === "login_required") {
        return { status: "safe_stop", reason: "LOGIN_REQUIRED" };
      }
      return { status: "observed", observation };
    });
  } catch {
    return technicalFailure("INSPECTION_FAILED");
  }
}

function createDryRunPage(page: Page): DryRunPage {
  const reader = createPlaywrightCheckoutReader(page);
  return {
    ...reader,
    navigate: async (url) => {
      await page.goto(url, { waitUntil: "domcontentloaded" });
    },
    currentUrl: () => page.url()
  };
}

function isExpectedCheckout(actual: string, expected: string): boolean {
  try {
    return (
      validateCheckoutUrl(actual).href === validateCheckoutUrl(expected).href
    );
  } catch {
    return false;
  }
}

function technicalFailure(
  reason: Extract<
    DryInspectionResult,
    { status: "technical_failure" }
  >["reason"]
): Extract<DryInspectionResult, { status: "technical_failure" }> {
  return { status: "technical_failure", reason };
}
