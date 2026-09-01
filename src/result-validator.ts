import { createRequire } from "node:module";

import resultSchema from "../schemas/result.schema.json" with { type: "json" };
import type { BookingInput, BookingResult } from "./contracts.js";
import { normalizePackageNameForComparison } from "./package-selection.js";
import { validateCalendarUrl, validateCheckoutUrl } from "./url-policy.js";

const require = createRequire(import.meta.url);
const Ajv = require("ajv").default;
const addFormats = require("ajv-formats").default;
const validator = addFormats(
  new Ajv({ allErrors: true, strict: true })
).compile(resultSchema);

export const validateResult = (value: unknown): value is BookingResult =>
  (validator(value) as boolean) &&
  !(
    (value as BookingResult).outcome === "DRY_RUN" &&
    (value as BookingResult).observed_class === undefined
  ) &&
  hasExactSelectedPackageEvidence(value as BookingResult);

export function validateResultForInput(
  value: unknown,
  input: BookingInput
): value is BookingResult {
  if (!validateResult(value)) return false;
  if (!hasPermittedAction(value, input)) return false;
  if (!hasPolicyBoundPackageEvidence(value, input)) return false;
  const calendarUrl = (value as { google_calendar_url?: unknown })
    .google_calendar_url;
  return (
    calendarUrl === undefined ||
    (typeof calendarUrl === "string" &&
      permitsCalendarUrl(value) &&
      validateCalendarUrlForCheckout(calendarUrl, input.booking_url))
  );
}

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
  const classId = checkout.pathname.split("/")[5];
  return (
    classId !== undefined &&
    calendar.pathname === "/api/calendar/google" &&
    calendar.search === `?classId=${classId}`
  );
}

function hasPermittedAction(
  result: BookingResult,
  input: BookingInput
): boolean {
  if (result.outcome === "BOOKED") {
    return !input.dry_run && permits(input, "book");
  }
  if (result.outcome === "WAITLISTED") {
    return !input.dry_run && permits(input, "waitlist");
  }
  if (result.outcome !== "DRY_RUN") {
    return (
      !input.dry_run ||
      result.outcome === "SAFE_STOP" ||
      result.outcome === "TECHNICAL_FAILURE"
    );
  }
  if (!input.dry_run) return false;
  if (result.availability === "BOOKING_AVAILABLE") {
    return permits(input, "book");
  }
  return (
    result.availability !== "WAITLIST_AVAILABLE" || permits(input, "waitlist")
  );
}

function permits(input: BookingInput, action: "book" | "waitlist"): boolean {
  return input.permitted_actions.some((candidate) => candidate === action);
}

function hasPolicyBoundPackageEvidence(
  result: BookingResult,
  input: BookingInput
): boolean {
  const evidence = result as {
    package_selected?: unknown;
    packages_before?: unknown;
  };
  if (evidence.package_selected === undefined) return true;
  if (!Array.isArray(evidence.packages_before)) return false;
  const canonical = new Map<string, string>();
  for (const name of input.allowed_packages) {
    const normalized = normalizePackageNameForComparison(name);
    if (normalized.length === 0 || canonical.has(normalized)) return false;
    canonical.set(normalized, name);
  }
  for (const candidate of evidence.packages_before) {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      typeof (candidate as { name?: unknown }).name !== "string" ||
      typeof (candidate as { approved?: unknown }).approved !== "boolean"
    )
      return false;
    const { name, approved } = candidate as { name: string; approved: boolean };
    const normalized = normalizePackageNameForComparison(name);
    const configured = canonical.get(normalized);
    if (
      approved
        ? configured !== name
        : configured !== undefined || name !== normalized
    ) {
      return false;
    }
  }
  if (evidence.package_selected === null) return true;
  return (
    typeof evidence.package_selected === "string" &&
    canonical.get(
      normalizePackageNameForComparison(evidence.package_selected)
    ) === evidence.package_selected
  );
}

function hasExactSelectedPackageEvidence(result: BookingResult): boolean {
  const evidence = result as {
    package_selected?: unknown;
    packages_before?: unknown;
  };
  if (evidence.package_selected === undefined) return true;
  if (!Array.isArray(evidence.packages_before)) return false;
  if (evidence.package_selected === null) {
    return evidence.packages_before.every(
      (candidate) =>
        typeof candidate === "object" &&
        candidate !== null &&
        (candidate as { approved?: unknown }).approved === false
    );
  }
  if (typeof evidence.package_selected !== "string") return false;
  const selected = normalizePackageNameForComparison(evidence.package_selected);
  return (
    selected.length > 0 &&
    evidence.packages_before.some(
      (candidate) =>
        typeof candidate === "object" &&
        candidate !== null &&
        (candidate as { approved?: unknown }).approved === true &&
        Number.isSafeInteger(
          (candidate as { remaining?: unknown }).remaining
        ) &&
        (candidate as { remaining: number }).remaining > 0 &&
        typeof (candidate as { name?: unknown }).name === "string" &&
        normalizePackageNameForComparison(
          (candidate as { name: string }).name
        ) === selected
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
