import { createRequire } from "node:module";

import requestSchema from "../schemas/request.schema.json" with { type: "json" };
import type { BookingPolicy, BookingRequest } from "./contracts.js";
import { validateCheckoutUrl } from "./url-policy.js";

const require = createRequire(import.meta.url);
const Ajv = require("ajv").default;
const addFormats = require("ajv-formats").default;
const validateRequestSchema = addFormats(
  new Ajv({ allErrors: true, strict: true })
).compile(requestSchema);

export function validateRequest(
  value: unknown,
  policy: BookingPolicy
): BookingRequest {
  if (!validateRequestSchema(value)) {
    throw new Error("Invalid booking request.");
  }

  const request = value as BookingRequest;
  try {
    validateCheckoutUrl(request.booking_url);
  } catch {
    throw new Error("Invalid booking request.");
  }

  if (request.policy_version !== policy.policy_version) {
    throw new Error("Invalid booking request.");
  }

  return request;
}
