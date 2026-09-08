import { expect, test } from "vitest";

import { projectDebugException } from "../src/debug-exception.js";

test("does not unwrap browser navigation errors containing a resolved checkout URL", () => {
  const checkoutUrl =
    "https://app.arketa.co/iframe/synthetic-studio/calendar/checkout/private-token";
  const cause = new Error(`page.goto: navigation failed at ${checkoutUrl}`);
  const error = new Error("Booking browser navigation failed.", { cause });
  error.name = "BookingBrowserError";

  const projected = projectDebugException(error);

  expect(projected).toMatchObject({
    name: "BookingBrowserError",
    message: "Booking browser navigation failed."
  });
  expect(JSON.stringify(projected)).not.toContain(checkoutUrl);
});
