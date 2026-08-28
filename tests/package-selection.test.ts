import { describe, expect, it } from "vitest";

import {
  choosePackage,
  normalizePackageNameForComparison,
  type PackageOption
} from "../src/package-selection.js";
import type { BookingPolicy } from "../src/contracts.js";

const policy: BookingPolicy = {
  schema_version: 1,
  policy_version: "2030-01-01",
  allowed_packages: ["5 Reformer Classes", "10 Reformer Classes"]
};

function option(overrides: Partial<PackageOption>): PackageOption {
  return {
    row: 1,
    name: "Unconfigured Package",
    remaining: 1,
    active: true,
    product: false,
    control: { visibleCount: 1, selected: false, enabled: true },
    ...overrides
  };
}

describe("normalizePackageNameForComparison", () => {
  it.each([
    ["  ⭐ 5 Reformer Classes  ", "5 Reformer Classes"],
    ["✨✨  5   Reformer Classes ★", "5 Reformer Classes"],
    ["Founder's 5-Class Pack", "Founder's 5-Class Pack"],
    ["5 Reformer Classes", "5 Reformer Classes"]
  ])("normalizes %j to %j", (rendered, expected) => {
    expect(normalizePackageNameForComparison(rendered)).toBe(expected);
  });

  it.each(["reformer classes", "Reformer Classes", "5 Reformer Class"])(
    "does not normalize %j to 5 Reformer Classes",
    (rendered) => {
      expect(normalizePackageNameForComparison(rendered)).not.toBe(
        "5 Reformer Classes"
      );
    }
  );
});

describe("choosePackage", () => {
  it("selects the first configured package instead of the first page option", () => {
    const options = [
      option({ row: 1, name: "10 Reformer Classes", remaining: 2 }),
      option({ row: 2, name: "✨ 5 Reformer Classes", remaining: 4 })
    ];

    expect(choosePackage(policy, options)).toMatchObject({
      configuredName: "5 Reformer Classes",
      option: { row: 2, remaining: 4 }
    });
  });

  it("ignores a preselected package that policy does not approve", () => {
    const options = [
      option({
        row: 1,
        name: "Unconfigured Package",
        remaining: 5,
        control: { visibleCount: 1, selected: true, enabled: true }
      }),
      option({ row: 2, name: "5 Reformer Classes", remaining: 1 })
    ];

    expect(choosePackage(policy, options)).toMatchObject({
      configuredName: "5 Reformer Classes",
      option: { row: 2, name: "5 Reformer Classes" }
    });
  });

  it("falls back from a zero balance to a lower-priority positive balance", () => {
    const options = [
      option({ row: 1, name: "5 Reformer Classes", remaining: 0 }),
      option({ row: 2, name: "10 Reformer Classes", remaining: 2 })
    ];

    expect(choosePackage(policy, options)?.option).toMatchObject({ row: 2 });
  });

  it("does not choose inactive or product offers", () => {
    const options = [
      option({
        row: 1,
        name: "5 Reformer Classes",
        remaining: 4,
        active: false
      }),
      option({
        row: 2,
        name: "10 Reformer Classes",
        remaining: 3,
        product: true
      })
    ];

    expect(choosePackage(policy, options)).toBeUndefined();
  });

  it("fails closed when page names duplicate after normalization", () => {
    const options = [
      option({ row: 1, name: "✨ 5 Reformer Classes", remaining: 4 }),
      option({ row: 2, name: "5 Reformer Classes ★", remaining: 2 })
    ];

    expect(choosePackage(policy, options)).toBeUndefined();
  });

  it.each([
    [
      "duplicate normalized policy names",
      ["⭐ 5 Reformer Classes", "5 Reformer Classes"] as const
    ],
    ["an empty normalized policy name", ["✨✨"] as const]
  ])("fails closed for %s", (_case, allowed_packages) => {
    const invalidPolicy: BookingPolicy = { ...policy, allowed_packages };

    expect(
      choosePackage(invalidPolicy, [
        option({ row: 1, name: "5 Reformer Classes", remaining: 4 })
      ])
    ).toBeUndefined();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, 2 ** 53])(
    "fails closed for a non-negative safe integer balance of %s",
    (remaining) => {
      expect(
        choosePackage(policy, [
          option({ row: 1, name: "5 Reformer Classes", remaining })
        ])
      ).toBeUndefined();
    }
  );

  it("projects canonical balances while retaining the configured policy name", () => {
    const configuredPolicy: BookingPolicy = {
      ...policy,
      allowed_packages: ["⭐ 5 Reformer Classes", "10 Reformer Classes"]
    };
    const selected = option({
      row: 3,
      name: "5 Reformer Classes ★",
      remaining: 4,
      control: { visibleCount: 1, selected: false, enabled: true }
    });
    const unapproved = option({
      row: 4,
      name: "Unconfigured Package",
      remaining: 8,
      active: false,
      control: { visibleCount: 0, selected: true, enabled: false }
    });

    expect(choosePackage(configuredPolicy, [selected, unapproved])).toEqual({
      option: selected,
      configuredName: "⭐ 5 Reformer Classes",
      balances: [
        { name: "5 Reformer Classes ★", remaining: 4, approved: true },
        { name: "Unconfigured Package", remaining: 8, approved: false }
      ]
    });
  });
});
