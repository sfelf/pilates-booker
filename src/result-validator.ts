import { createRequire } from "node:module";

import resultSchema from "../schemas/result.schema.json" with { type: "json" };
import type { BookingResult } from "./contracts.js";
import { normalizePackageNameForComparison } from "./package-selection.js";

const require = createRequire(import.meta.url);
const Ajv = require("ajv").default;
const addFormats = require("ajv-formats").default;
const ajv = addFormats(new Ajv({ allErrors: true, strict: true }));
const resultValidator = ajv.compile(resultSchema);

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
