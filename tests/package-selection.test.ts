import { describe, expect, it } from "vitest";

import {
  choosePackage,
  decidePackage,
  normalizePackageNameForComparison,
  type PackageOption
} from "../src/package-selection.js";
import type { PackagePolicy } from "../src/contracts.js";

const policy: PackagePolicy = {
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
  it("projects canonical positive balances in page order before choosing by policy priority", () => {
    const decision = decidePackage(
      {
        ...policy,
        allowed_packages: ["Synthetic Priority Package"]
      },
      [
        option({
          row: 1,
          name: " ✨ Founder's Other Pack ★ ",
          remaining: 2
        }),
        option({
          row: 2,
          name: "⭐ Synthetic Priority Package ★",
          remaining: 3
        }),
        option({ row: 3, name: "Zero Balance", remaining: 0 }),
        option({ row: 4, name: "Inactive", remaining: 8, active: false }),
        option({ row: 5, name: "Product", remaining: 5, product: true })
      ]
    );

    expect(decision?.balances).toEqual([
      { name: "Founder's Other Pack", remaining: 2, approved: false },
      { name: "Synthetic Priority Package", remaining: 3, approved: true }
    ]);
    expect(decision?.selection).toMatchObject({
      configuredName: "Synthetic Priority Package",
      option: { row: 2 }
    });
  });

  it("retains trustworthy positive inventory with no approved selection", () => {
    const decision = decidePackage(policy, [
      option({
        name: " ✨ Founder's Other Pack ★ ",
        remaining: 2
      })
    ]);

    expect(decision).toEqual({
      balances: [
        { name: "Founder's Other Pack", remaining: 2, approved: false }
      ],
      selection: null
    });
    expect(
      choosePackage(policy, [
        option({ name: "Founder's Other Pack", remaining: 2 })
      ])
    ).toBeUndefined();
  });

  it.each([
    ["raw NUL", "Other\u0000Pack"],
    ["JSON-escaped NUL", JSON.parse('"Other\\u0000Pack"') as string],
    [
      "JSON-escaped format character",
      JSON.parse('"Other\\u200BPack"') as string
    ]
  ])("fails closed for a page name with %s", (_label, name) => {
    expect(
      decidePackage(policy, [option({ name, remaining: 2 })])
    ).toBeUndefined();
  });

  it("preserves valid Unicode catalog text in unapproved evidence", () => {
    expect(
      decidePackage(policy, [
        option({ name: "Mañana Pilates — 會員專享", remaining: 2 })
      ])
    ).toEqual({
      balances: [
        { name: "Mañana Pilates — 會員專享", remaining: 2, approved: false }
      ],
      selection: null
    });
  });

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

  it.each([
    [
      "product",
      option({
        row: 1,
        name: "✨ 5 Reformer Classes",
        remaining: Number.NaN,
        product: true
      })
    ],
    [
      "inactive package",
      option({
        row: 1,
        name: "✨ 5 Reformer Classes",
        remaining: -1,
        active: false
      })
    ]
  ] as const)(
    "excludes a same-name %s from ambiguity, balance validation, and evidence",
    (_kind, excluded) => {
      const selected = option({
        row: 2,
        name: "5 Reformer Classes ★",
        remaining: 4
      });

      expect(choosePackage(policy, [excluded, selected])).toEqual({
        option: selected,
        configuredName: "5 Reformer Classes",
        balances: [{ name: "5 Reformer Classes", remaining: 4, approved: true }]
      });
    }
  );

  it("fails closed when page names duplicate after normalization", () => {
    const options = [
      option({ row: 1, name: "✨ 5 Reformer Classes", remaining: 4 }),
      option({ row: 2, name: "5 Reformer Classes ★", remaining: 2 })
    ];

    expect(decidePackage(policy, options)).toBeUndefined();
  });

  it.each([
    [
      "duplicate normalized policy names",
      ["⭐ 5 Reformer Classes", "5 Reformer Classes"] as const
    ],
    ["an empty normalized policy name", ["✨✨"] as const]
  ])("fails closed for %s", (_case, allowed_packages) => {
    const invalidPolicy: PackagePolicy = { ...policy, allowed_packages };

    expect(
      decidePackage(invalidPolicy, [
        option({ row: 1, name: "5 Reformer Classes", remaining: 4 })
      ])
    ).toBeUndefined();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, 2 ** 53])(
    "fails closed for a non-negative safe integer balance of %s",
    (remaining) => {
      expect(
        decidePackage(policy, [
          option({ row: 1, name: "5 Reformer Classes", remaining })
        ])
      ).toBeUndefined();
    }
  );

  it("projects canonical balances while retaining the configured policy name", () => {
    const configuredPolicy: PackagePolicy = {
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
        { name: "⭐ 5 Reformer Classes", remaining: 4, approved: true }
      ]
    });
  });
});
