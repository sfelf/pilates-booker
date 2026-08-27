import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import policySchema from "../schemas/policy.schema.json" with { type: "json" };
import type { BookingPolicy, PackageBalance } from "./contracts.js";

const require = createRequire(import.meta.url);
const Ajv = require("ajv").default;
const validatePolicySchema = new Ajv({ allErrors: true, strict: true }).compile(
  policySchema
);

export async function loadPolicy(path: string): Promise<BookingPolicy> {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!validatePolicySchema(value)) {
      throw new Error("invalid schema");
    }
    return value as BookingPolicy;
  } catch {
    throw new Error("Invalid booking policy.");
  }
}

export function selectEligiblePackage(
  policy: BookingPolicy,
  observed: readonly PackageBalance[]
): PackageBalance | undefined {
  const names = new Set<string>();
  for (const candidate of observed) {
    if (
      names.has(candidate.name) ||
      !Number.isFinite(candidate.remaining) ||
      !Number.isInteger(candidate.remaining) ||
      candidate.remaining < 0
    ) {
      return undefined;
    }
    names.add(candidate.name);
  }

  for (const allowedName of policy.allowed_packages) {
    const candidate = observed.find(
      ({ name, remaining }) => name === allowedName && remaining > 0
    );
    if (candidate !== undefined) {
      return {
        name: candidate.name,
        remaining: candidate.remaining,
        approved: true
      };
    }
  }

  return undefined;
}
