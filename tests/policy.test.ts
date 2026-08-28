import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { BookingPolicy, PackageBalance } from "../src/contracts.js";
import { loadPolicy, selectEligiblePackage } from "../src/policy.js";

const policy: BookingPolicy = {
  schema_version: 1,
  policy_version: "2030-01-01",
  allowed_packages: ["Synthetic Priority Package", "Synthetic Backup Package"]
};

async function writePolicy(value: unknown): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "arketa-policy-test-"));
  const path = join(directory, "policy.json");
  await writeFile(path, JSON.stringify(value), "utf8");
  return path;
}

describe("loadPolicy", () => {
  it("loads the repository's synthetic example as a valid policy", async () => {
    const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

    await expect(
      loadPolicy(join(repositoryRoot, "config/booking-policy.example.json"))
    ).resolves.toEqual(policy);
  });

  it("loads a schema-valid policy without changing package order", async () => {
    const path = await writePolicy(policy);

    await expect(loadPolicy(path)).resolves.toEqual(policy);
  });

  it.each([
    ["missing", join(tmpdir(), "synthetic-private-missing-policy.json")],
    ["unreadable", tmpdir()]
  ])("rejects a %s policy with a fixed diagnostic", async (_case, path) => {
    await expect(loadPolicy(path)).rejects.toThrow("Invalid booking policy.");
  });

  it("rejects invalid JSON without exposing its contents", async () => {
    const path = await writePolicy("synthetic-private-policy-content");
    await writeFile(path, '{"private":"synthetic-secret"', "utf8");

    try {
      await loadPolicy(path);
      throw new Error("expected policy rejection");
    } catch (error) {
      expect((error as Error).message).toBe("Invalid booking policy.");
      expect((error as Error).message).not.toContain("synthetic-secret");
      expect((error as Error).message).not.toContain(path);
    }
  });

  it.each([
    { ...policy, allowed_packages: [] },
    {
      ...policy,
      allowed_packages: [
        "Synthetic Priority Package",
        "Synthetic Priority Package"
      ]
    },
    { ...policy, allowed_packages: ["Synthetic Priority Package", ""] },
    { ...policy, unknown: true }
  ])("rejects invalid policy data %#", async (value) => {
    const path = await writePolicy(value);

    await expect(loadPolicy(path)).rejects.toThrow("Invalid booking policy.");
  });
});

describe("selectEligiblePackage", () => {
  it("selects the first configured package with a positive balance", () => {
    const observed: readonly PackageBalance[] = [
      { name: "Synthetic Backup Package", remaining: 3, approved: false },
      { name: "Synthetic Priority Package", remaining: 1, approved: false }
    ];

    expect(selectEligiblePackage(policy, observed)).toEqual({
      name: "Synthetic Priority Package",
      remaining: 1,
      approved: true
    });
  });

  it("projects only result-contract fields from an observed package", () => {
    const observed = [
      {
        name: "Synthetic Priority Package",
        remaining: 1,
        approved: false,
        scraped_private_detail: "must not cross the boundary"
      }
    ];

    expect(selectEligiblePackage(policy, observed)).toEqual({
      name: "Synthetic Priority Package",
      remaining: 1,
      approved: true
    });
  });

  it("falls back only when the higher-priority package has no balance", () => {
    const observed: readonly PackageBalance[] = [
      { name: "Synthetic Priority Package", remaining: 0, approved: false },
      { name: "Synthetic Backup Package", remaining: 2, approved: false }
    ];

    expect(selectEligiblePackage(policy, observed)?.name).toBe(
      "Synthetic Backup Package"
    );
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5])(
    "does not select an invalid observed balance %s",
    (remaining) => {
      expect(
        selectEligiblePackage(policy, [
          { name: "Synthetic Priority Package", remaining, approved: false }
        ])
      ).toBeUndefined();
    }
  );

  it("does not select renamed or unapproved packages", () => {
    expect(
      selectEligiblePackage(policy, [
        {
          name: "Synthetic Priority Package Plus",
          remaining: 4,
          approved: false
        }
      ])
    ).toBeUndefined();
  });

  it("fails closed when an observed package name is duplicated", () => {
    expect(
      selectEligiblePackage(policy, [
        { name: "Synthetic Priority Package", remaining: 1, approved: false },
        { name: "Synthetic Priority Package", remaining: 2, approved: false }
      ])
    ).toBeUndefined();
  });
});
