import { createRequire } from "node:module";

import resultSchema from "../schemas/result.schema.json" with { type: "json" };
import type { BookingRequest, BookingResult } from "./contracts.js";
import { normalizePackageNameForComparison } from "./package-selection.js";
import { validateCalendarUrl, validateCheckoutUrl } from "./url-policy.js";

const require = createRequire(import.meta.url);
const Ajv = require("ajv").default;
const addFormats = require("ajv-formats").default;
const ajv = addFormats(new Ajv({ allErrors: true, strict: true }));
const resultValidator = ajv.compile(resultSchema);

export function validateCalendarUrlForCheckout(
  value: string,
  checkoutUrl: string
): boolean {
  let checkout: URL;
  try {
    checkout = validateCheckoutUrl(checkoutUrl);
  } catch {
    return false;
  }
  if (value.includes("%") || validateCalendarUrl(value) === undefined) {
    return false;
  }

  const calendar = new URL(value);
  const checkoutClassId = checkout.pathname.split("/")[5];
  return (
    checkoutClassId !== undefined &&
    calendar.pathname === "/api/calendar/google" &&
    calendar.search === `?classId=${checkoutClassId}`
  );
}

export const validateResult = (value: unknown): value is BookingResult => {
  if (!(resultValidator(value) as boolean)) return false;
  const result = value as BookingResult;
  if (result.outcome === "DRY_RUN" && result.observed_class === undefined) {
    return false;
  }
  if (
    result.outcome !== "DRY_RUN" ||
    (result.availability !== "BOOKING_AVAILABLE" &&
      result.availability !== "WAITLIST_AVAILABLE")
  ) {
    return true;
  }
  if (
    result.packages_before.some(
      (candidate) =>
        !Number.isSafeInteger(candidate.remaining) || candidate.remaining < 0
    )
  ) {
    return false;
  }

  const configuredName = normalizePackageNameForComparison(
    result.package_selected
  );
  return (
    configuredName.length > 0 &&
    result.packages_before.some(
      (candidate) =>
        candidate.approved &&
        candidate.remaining > 0 &&
        normalizePackageNameForComparison(candidate.name) === configuredName
    )
  );
};

export function validateResultForRequest(
  result: unknown,
  request: BookingRequest
): result is BookingResult {
  if (!validateResult(result) || result.request_id !== request.request_id) {
    return false;
  }
  if (!hasExpectedClassWhenVerified(result, request)) return false;
  if (!hasPermittedAction(result, request)) return false;
  if (!hasExactSelectedPackageEvidence(result)) return false;

  const calendarUrl = (result as { google_calendar_url?: unknown })
    .google_calendar_url;
  return (
    calendarUrl === undefined ||
    (typeof calendarUrl === "string" &&
      permitsCalendarUrl(result) &&
      validateCalendarUrlForCheckout(calendarUrl, request.booking_url))
  );
}

function hasExpectedClassWhenVerified(
  result: BookingResult,
  request: BookingRequest
): boolean {
  const observedClass = (
    result as { observed_class?: BookingRequest["expected_class"] }
  ).observed_class;
  if (observedClass === undefined || !result.safety_checks.exact_class_match) {
    return true;
  }

  const expectedClass = request.expected_class;
  return (
    observedClass.name === expectedClass.name &&
    observedClass.date === expectedClass.date &&
    observedClass.start_time === expectedClass.start_time &&
    observedClass.timezone === expectedClass.timezone
  );
}

function hasPermittedAction(
  result: BookingResult,
  request: BookingRequest
): boolean {
  if (result.outcome === "BOOKED") {
    return !request.dry_run && permitsAction(request, "book");
  }
  if (result.outcome === "WAITLISTED") {
    return !request.dry_run && permitsAction(request, "waitlist");
  }
  if (result.outcome !== "DRY_RUN") return true;
  if (!request.dry_run) return false;
  if (result.availability === "BOOKING_AVAILABLE") {
    return permitsAction(request, "book");
  }
  return (
    result.availability !== "WAITLIST_AVAILABLE" ||
    permitsAction(request, "waitlist")
  );
}

function permitsAction(
  request: BookingRequest,
  action: "book" | "waitlist"
): boolean {
  return request.permitted_actions.some((permitted) => permitted === action);
}

function hasExactSelectedPackageEvidence(result: BookingResult): boolean {
  const evidence = result as {
    package_selected?: unknown;
    packages_before?: unknown;
  };
  if (
    evidence.package_selected === undefined ||
    evidence.package_selected === null
  ) {
    return true;
  }
  if (
    typeof evidence.package_selected !== "string" ||
    !Array.isArray(evidence.packages_before)
  ) {
    return false;
  }

  const configuredName = normalizePackageNameForComparison(
    evidence.package_selected
  );
  return (
    configuredName.length > 0 &&
    evidence.packages_before.some(
      (candidate) =>
        typeof candidate === "object" &&
        candidate !== null &&
        (candidate as { approved?: unknown }).approved === true &&
        (candidate as { remaining?: unknown }).remaining !== undefined &&
        Number.isSafeInteger((candidate as { remaining: number }).remaining) &&
        (candidate as { remaining: number }).remaining > 0 &&
        typeof (candidate as { name?: unknown }).name === "string" &&
        normalizePackageNameForComparison(
          (candidate as { name: string }).name
        ) === configuredName
    )
  );
}

function permitsCalendarUrl(result: BookingResult): boolean {
  return (
    result.outcome === "BOOKED" ||
    result.outcome === "ALREADY_BOOKED" ||
    (result.outcome === "DRY_RUN" && result.availability === "ALREADY_BOOKED")
  );
}
