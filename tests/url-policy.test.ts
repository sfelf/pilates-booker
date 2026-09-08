import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import resultSchema from "../schemas/result.schema.json" with { type: "json" };
import {
  validateCalendarPageUrl,
  validateCalendarUrl,
  validateCheckoutUrl,
  validateCheckoutUrlForCalendar
} from "../src/url-policy.js";
import { validateCalendarUrlForCheckout } from "../src/result-validator.js";

const require = createRequire(import.meta.url);
const Ajv = require("ajv").default;
const addFormats = require("ajv-formats").default;
const validateResult = addFormats(
  new Ajv({ allErrors: true, strict: true })
).compile(resultSchema);

const checkoutUrl =
  "https://app.arketa.co/iframe/example/calendar/checkout/FAKE_CHECKOUT_ID";
const calendarOrigin = "https://app.arketa.co";
const calendarPageUrl =
  "https://app.arketa.co/iframe/synthetic-studio/calendar";

function resultWithCalendarUrl(googleCalendarUrl: string) {
  return {
    schema_version: 2,
    outcome: "ALREADY_BOOKED",
    exit_code: 0,
    action_submitted: false,
    confirmation_verified: true,
    observed_class: {
      name: "Synthetic Reformer Flow",
      instructor: "Synthetic Instructor",
      date: "2030-01-16",
      start_time: "10:30",
      end_time: "11:30",
      timezone: "America/Los_Angeles"
    },
    google_calendar_url: googleCalendarUrl,
    safety_checks: {
      approved_package_verified: true,
      no_charge: true,
      cancellation_policy_accepted: false
    },
    details: "Existing booking confirmed."
  };
}

describe("validateCheckoutUrl", () => {
  it("accepts an exact Arketa checkout URL", () => {
    expect(validateCheckoutUrl(checkoutUrl).href).toBe(checkoutUrl);
  });

  it.each([
    "http://app.arketa.co/iframe/example/calendar/checkout/FAKE_CHECKOUT_ID",
    "https://APP.ARKETA.CO/iframe/example/calendar/checkout/FAKE_CHECKOUT_ID",
    "https://user@app.arketa.co/iframe/example/calendar/checkout/FAKE_CHECKOUT_ID",
    "https://app.arketa.co:444/iframe/example/calendar/checkout/FAKE_CHECKOUT_ID",
    "https://app.arketa.co/iframe/example/calendar/checkout/FAKE_CHECKOUT_ID#step",
    "https://app.arketa.co/iframe/example/calendar/checkout/FAKE_CHECKOUT_ID#",
    "https://app.arketa.co/iframe/example/calendar/checkout/FAKE_CHECKOUT_ID?mode=book",
    "https://app.arketa.co/iframe/example/calendar/checkout/FAKE_CHECKOUT_ID?",
    "https://app.arketa.co/iframe/example/calendar/checkout/",
    "https://app.arketa.co/iframe/example/calendar/checkout/FAKE/CHECKOUT",
    "https://app.arketa.co/iframe/example/calendar/%63heckout/FAKE_CHECKOUT_ID",
    "https://app.arketa.co/iframe/example/calendar/%2563heckout/FAKE_CHECKOUT_ID",
    "https://app.arketa.co/iframe/example/calendar/checkout%2fFAKE_CHECKOUT_ID",
    "https://app.arketa.co/iframe/example/calendar/checkout\\FAKE_CHECKOUT_ID",
    "https:\\app.arketa.co\\iframe\\example\\calendar\\checkout\\FAKE_CHECKOUT_ID",
    "https://app.arketa.co.evil.example/iframe/example/calendar/checkout/FAKE_CHECKOUT_ID",
    "https://app.arketa.co%2eevil.example/iframe/example/calendar/checkout/FAKE_CHECKOUT_ID",
    "https://app%252earketa.co/iframe/example/calendar/checkout/FAKE_CHECKOUT_ID"
  ])("rejects unsafe checkout representation %s", (raw) => {
    expect(() => validateCheckoutUrl(raw)).toThrow(/checkout URL/i);
  });
});

describe("validateCalendarUrl", () => {
  it("preserves a valid exact-host calendar URL", () => {
    const raw = "https://app.arketa.co/example/FAKE_EVENT_ID?view=calendar";

    expect(validateCalendarUrl(raw)).toBe(raw);
  });

  it.each([
    "http://app.arketa.co/example/FAKE_EVENT_ID",
    "https://APP.ARKETA.CO/example/FAKE_EVENT_ID",
    "https://user@app.arketa.co/example/FAKE_EVENT_ID",
    "https://app.arketa.co:444/example/FAKE_EVENT_ID",
    "https://app.arketa.co/example/FAKE_EVENT_ID#private",
    "https://evil.example/example/FAKE_EVENT_ID",
    "https://app.arketa.co.evil.example/example/FAKE_EVENT_ID",
    "https://app.arketa.co%2eevil.example/example/FAKE_EVENT_ID",
    "https://app%252earketa.co/example/FAKE_EVENT_ID",
    "https://app.arketa.co/example\\FAKE_EVENT_ID",
    "https:\\app.arketa.co\\example\\FAKE_EVENT_ID",
    "https://app.arketa.co/example/FAKE%0AEVENT_ID",
    "https://app.arketa.co/example/FAKE%zzEVENT_ID",
    "https://app.arketa.co/example/FAKE%EVENT_ID",
    "https://app.arketa.co/example/FAKE EVENT ID",
    "https://app.arketa.co/example/FAKE|EVENT_ID",
    "https://app.arketa.co/example/FAKE{EVENT_ID",
    "https://app.arketa.co/example/FAKE^EVENT_ID"
  ])("omits unsafe calendar URL %s", (raw) => {
    expect(validateCalendarUrl(raw)).toBeUndefined();
  });

  it("preserves valid percent-encoded URI syntax", () => {
    const raw = "https://app.arketa.co/example/FAKE%20EVENT_ID";

    expect(validateCalendarUrl(raw)).toBe(raw);
  });

  const maximumLengthUrl = `${calendarOrigin}/${"A".repeat(
    4096 - calendarOrigin.length - 1
  )}`;
  const calendarBoundaryCases = [
    {
      label: "plain exact-host URI",
      raw: `${calendarOrigin}/example/FAKE_EVENT_ID`,
      accepted: true
    },
    {
      label: "empty query delimiter",
      raw: `${calendarOrigin}/example/FAKE_EVENT_ID?`,
      accepted: true
    },
    {
      label: "encoded Unicode path",
      raw: `${calendarOrigin}/example/%F0%9F%91%A9%E2%80%8D%F0%9F%91%A9`,
      accepted: true
    },
    {
      label: "encoded query value",
      raw: `${calendarOrigin}/example/FAKE_EVENT_ID?view=synthetic%20calendar`,
      accepted: true
    },
    { label: "maximum length URI", raw: maximumLengthUrl, accepted: true },
    {
      label: "empty fragment delimiter",
      raw: `${calendarOrigin}/example/FAKE_EVENT_ID#`,
      accepted: false
    },
    {
      label: "RFC-invalid path character",
      raw: `${calendarOrigin}/example/FAKE|EVENT_ID`,
      accepted: false
    },
    {
      label: "malformed percent escape",
      raw: `${calendarOrigin}/example/FAKE%zzEVENT_ID`,
      accepted: false
    },
    {
      label: "repeatedly encoded control",
      raw: `${calendarOrigin}/example/FAKE%250AEVENT_ID`,
      accepted: false
    },
    {
      label: "overlength URI",
      raw: `${maximumLengthUrl}A`,
      accepted: false
    },
    {
      label: "host confusion",
      raw: "https://app.arketa.co.evil.example/example/FAKE_EVENT_ID",
      accepted: false
    }
  ] as const;

  it.each(calendarBoundaryCases)(
    "enforces the calendar-to-result boundary for $label",
    ({ raw, accepted: expectedAccepted }) => {
      const accepted = validateCalendarUrl(raw);

      expect(accepted !== undefined).toBe(expectedAccepted);
      if (accepted !== undefined) {
        expect(accepted).toBe(raw);
        expect(validateResult(resultWithCalendarUrl(accepted))).toBe(true);
      }
    }
  );
});

describe("validateCalendarPageUrl", () => {
  it("returns the exact validated Arketa calendar page URL", () => {
    const validated = validateCalendarPageUrl(calendarPageUrl);

    expect(validated).toBeInstanceOf(URL);
    expect(validated.href).toBe(calendarPageUrl);
  });

  it.each([
    "https://app.arketa.co/iframe/synthetic-studio/calendar?view=week",
    "https://app.arketa.co/iframe/synthetic-studio/calendar?",
    "https://app.arketa.co/iframe/synthetic-studio/calendar#private",
    "https://app.arketa.co/iframe/synthetic-studio/calendar#",
    "https://user@app.arketa.co/iframe/synthetic-studio/calendar",
    "https://app.arketa.co:444/iframe/synthetic-studio/calendar",
    "https://APP.ARKETA.CO/iframe/synthetic-studio/calendar",
    "https://app.arketa.co/IFRAME/synthetic-studio/calendar",
    "https://app.arketa.co/iframe/synthetic-studio/Calendar",
    "https://app.arketa.co/iframe/synthetic-studio/CALENDAR",
    "https://app.arketa.co/iframe/synthetic-studio/calendar%3Fview=week",
    "https://app.arketa.co/iframe/synthetic-studio/%63alendar",
    "https://app.arketa.co/iframe/synthetic-studio/%2563alendar",
    "https://app.arketa.co/iframe/%73ynthetic-studio/calendar",
    "https://app.arketa.co/iframe/%2573ynthetic-studio/calendar",
    "https://app.arketa.co/iframe/synthetic-studio/calendar%2fextra",
    "https://app.arketa.co/iframe/synthetic-studio",
    "https://app.arketa.co/iframe/synthetic-studio/calendar/extra",
    "https://app.arketa.co/iframe/synthetic-studio/calendar/",
    "https://app.arketa.co/iframe/synthetic-studio/FAKE%zz/calendar",
    "https://app.arketa.co/iframe/synthetic-studio/FAKE%0A/calendar",
    "https://app.arketa.co/iframe/synthetic-studio/FAKE%250A/calendar",
    "https://app.arketa.co/iframe/synthetic-studio/FAKE|ID/calendar",
    "https://app.arketa.co/iframe/synthetic-studio/FAKE\nID/calendar",
    "https://app.arketa.co/iframe/synthetic-studio/FAKE\u2028ID/calendar"
  ])("rejects unsafe or non-page URL %s", (raw) => {
    expect(() => validateCalendarPageUrl(raw)).toThrow(/calendar page URL/i);
  });
});

describe("validateCheckoutUrlForCalendar", () => {
  const calendar = validateCalendarPageUrl(calendarPageUrl);
  const sameStudioCheckoutUrl =
    "https://app.arketa.co/iframe/synthetic-studio/calendar/checkout/FAKE_CHECKOUT_ID";

  it.each([
    {
      label: "absolute",
      raw: sameStudioCheckoutUrl,
      expected: sameStudioCheckoutUrl
    },
    {
      label: "relative",
      raw: "calendar/checkout/FAKE_CHECKOUT_ID",
      expected: sameStudioCheckoutUrl
    }
  ])("accepts a $label same-studio checkout URL", ({ raw, expected }) => {
    expect(validateCheckoutUrlForCalendar(raw, calendar).href).toBe(expected);
  });

  it.each([
    ["leading ASCII space", ` ${"calendar/checkout/FAKE_CHECKOUT_ID"}`],
    ["trailing ASCII space", `${"calendar/checkout/FAKE_CHECKOUT_ID"} `],
    ["leading ASCII tab", `\t${"calendar/checkout/FAKE_CHECKOUT_ID"}`],
    ["trailing ASCII tab", `${"calendar/checkout/FAKE_CHECKOUT_ID"}\t`],
    ["leading ASCII newline", `\n${"calendar/checkout/FAKE_CHECKOUT_ID"}`],
    ["trailing ASCII newline", `${"calendar/checkout/FAKE_CHECKOUT_ID"}\n`]
  ])("rejects normalized relative checkout URL with %s", (_label, raw) => {
    expect(() => validateCheckoutUrlForCalendar(raw, calendar)).toThrow(
      /checkout URL/i
    );
  });

  it.each([
    "https://app.arketa.co/iframe/other-studio/calendar/checkout/FAKE_CHECKOUT_ID",
    "/iframe/other-studio/calendar/checkout/FAKE_CHECKOUT_ID",
    "../other-studio/calendar/checkout/FAKE_CHECKOUT_ID",
    "calendar/checkout/FAKE_CHECKOUT_ID?mode=book",
    "calendar/checkout/FAKE_CHECKOUT_ID#step",
    "http://app.arketa.co/iframe/synthetic-studio/calendar/checkout/FAKE_CHECKOUT_ID",
    "https://APP.ARKETA.CO/iframe/synthetic-studio/calendar/checkout/FAKE_CHECKOUT_ID",
    "https://user@app.arketa.co/iframe/synthetic-studio/calendar/checkout/FAKE_CHECKOUT_ID",
    "https://app.arketa.co:444/iframe/synthetic-studio/calendar/checkout/FAKE_CHECKOUT_ID",
    "https://app.arketa.co/iframe/synthetic-studio/calendar/checkout/FAKE_CHECKOUT_ID#step",
    "https://app.arketa.co/iframe/synthetic-studio/calendar/checkout/FAKE_CHECKOUT_ID#",
    "https://app.arketa.co/iframe/synthetic-studio/calendar/checkout/FAKE_CHECKOUT_ID?mode=book",
    "https://app.arketa.co/iframe/synthetic-studio/calendar/checkout/FAKE_CHECKOUT_ID?",
    "https://app.arketa.co/iframe/synthetic-studio/calendar/checkout/",
    "https://app.arketa.co/iframe/synthetic-studio/calendar/checkout/FAKE/CHECKOUT",
    "https://app.arketa.co/iframe/synthetic-studio/calendar/%63heckout/FAKE_CHECKOUT_ID",
    "https://app.arketa.co/iframe/synthetic-studio/calendar/%2563heckout/FAKE_CHECKOUT_ID",
    "https://app.arketa.co/iframe/synthetic-studio/calendar/checkout%2fFAKE_CHECKOUT_ID",
    "https://app.arketa.co/iframe/synthetic-studio/calendar/checkout\\FAKE_CHECKOUT_ID",
    "https:\\app.arketa.co\\iframe\\synthetic-studio\\calendar\\checkout\\FAKE_CHECKOUT_ID",
    "https://app.arketa.co.evil.example/iframe/synthetic-studio/calendar/checkout/FAKE_CHECKOUT_ID",
    "https://app.arketa.co%2eevil.example/iframe/synthetic-studio/calendar/checkout/FAKE_CHECKOUT_ID",
    "https://app%252earketa.co/iframe/synthetic-studio/calendar/checkout/FAKE_CHECKOUT_ID"
  ])("rejects cross-studio or invalid checkout URL %s", (raw) => {
    expect(() => validateCheckoutUrlForCalendar(raw, calendar)).toThrow(
      /checkout URL/i
    );
  });

  it("rejects an unvalidated calendar binding", () => {
    const invalidCalendar = new URL(
      "https://app.arketa.co/iframe/other-studio/calendar/extra"
    );

    expect(() =>
      validateCheckoutUrlForCalendar(sameStudioCheckoutUrl, invalidCalendar)
    ).toThrow(/calendar page URL/i);
  });
});

describe("validateCalendarUrlForCheckout", () => {
  const calendarUrl =
    "https://app.arketa.co/api/calendar/google?classId=FAKE_CHECKOUT_ID";

  it("accepts only the calendar URL bound to the validated checkout class", () => {
    expect(validateCalendarUrlForCheckout(calendarUrl, checkoutUrl)).toBe(true);
  });

  it.each([
    "http://app.arketa.co/api/calendar/google?classId=FAKE_CHECKOUT_ID",
    "https://user@app.arketa.co/api/calendar/google?classId=FAKE_CHECKOUT_ID",
    "https://evil.example/api/calendar/google?classId=FAKE_CHECKOUT_ID",
    "https://app.arketa.co/calendar/google?classId=FAKE_CHECKOUT_ID",
    "https://app.arketa.co/api/calendar/google",
    "https://app.arketa.co/api/calendar/google?classId=",
    "https://app.arketa.co/api/calendar/google?classId=FAKE_CHECKOUT_ID&classId=FAKE_CHECKOUT_ID",
    "https://app.arketa.co/api/calendar/google?classId=OTHER_CHECKOUT_ID",
    "https://app.arketa.co/api/calendar/google?classId=FAKE_CHECKOUT_ID&view=calendar",
    "https://app.arketa.co/api/calendar/google?classId=FAKE_CHECKOUT_ID#event",
    "https://app.arketa.co/api/calendar/google%3FclassId=FAKE_CHECKOUT_ID",
    "https://app.arketa.co/api/calendar/google?classId=FAKE%5FCHECKOUT_ID",
    "https://app.arketa.co/api/calendar/google?classId=FAKE%255FCHECKOUT_ID"
  ])("rejects calendar URL %s", (raw) => {
    expect(validateCalendarUrlForCheckout(raw, checkoutUrl)).toBe(false);
  });
});
