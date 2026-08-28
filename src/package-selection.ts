import type { BookingPolicy, PackageBalance } from "./contracts.js";

export type PackageOption = Readonly<{
  row: number;
  name: string;
  remaining: number;
  active: boolean;
  product: boolean;
  control: Readonly<{
    visibleCount: number;
    selected: boolean;
    enabled: boolean;
  }>;
}>;

export type PackageSelection = Readonly<{
  option: PackageOption;
  configuredName: string;
  balances: readonly PackageBalance[];
}>;

const EDGE_DECORATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

export function normalizePackageNameForComparison(value: string): string {
  return value
    .replace(/\s+/gu, " ")
    .trim()
    .replace(EDGE_DECORATION, "")
    .trim()
    .replace(/\s+/gu, " ");
}

export function choosePackage(
  policy: BookingPolicy,
  options: readonly PackageOption[]
): PackageSelection | undefined {
  const configured = policy.allowed_packages.map((name) => ({
    name,
    normalizedName: normalizePackageNameForComparison(name)
  }));
  const normalizedNames = new Set<string>();

  for (const candidate of options) {
    const normalizedName = normalizePackageNameForComparison(candidate.name);
    if (
      normalizedNames.has(normalizedName) ||
      !Number.isSafeInteger(candidate.remaining) ||
      candidate.remaining < 0
    ) {
      return undefined;
    }
    normalizedNames.add(normalizedName);
  }

  const configuredNames = new Set(
    configured.map(({ normalizedName }) => normalizedName)
  );
  const balances: readonly PackageBalance[] = options.map((candidate) => ({
    name: candidate.name,
    remaining: candidate.remaining,
    approved: configuredNames.has(
      normalizePackageNameForComparison(candidate.name)
    )
  }));

  for (const candidate of configured) {
    const option = options.find(
      (observed) =>
        normalizePackageNameForComparison(observed.name) ===
          candidate.normalizedName &&
        observed.active &&
        !observed.product &&
        observed.remaining > 0
    );
    if (option !== undefined) {
      return { option, configuredName: candidate.name, balances };
    }
  }

  return undefined;
}
