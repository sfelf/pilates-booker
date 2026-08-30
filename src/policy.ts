import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import policySchema from "../schemas/policy.schema.json" with { type: "json" };
import type { BookingPolicy, PackageBalance } from "./contracts.js";
import { choosePackage } from "./package-selection.js";

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
  const selection = choosePackage(
    policy,
    observed.map((candidate, index) => ({
      row: index,
      name: candidate.name,
      remaining: candidate.remaining,
      active: true,
      product: false,
      control: { visibleCount: 1, selected: false, enabled: true }
    }))
  );

  if (selection === undefined) return undefined;

  return {
    name: selection.option.name,
    remaining: selection.option.remaining,
    approved: true
  };
}
