import type {
  BookingPolicy,
  NonEmptyPackageBalances,
  PackageBalance
} from "./contracts.js";

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
  balances: NonEmptyPackageBalances;
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
  const configuredNames = new Set<string>();
  const configured = [] as { name: string; normalizedName: string }[];
  for (const name of policy.allowed_packages) {
    const normalizedName = normalizePackageNameForComparison(name);
    if (normalizedName === "" || configuredNames.has(normalizedName)) {
      return undefined;
    }
    configuredNames.add(normalizedName);
    configured.push({ name, normalizedName });
  }
  const normalizedNames = new Set<string>();
  const activePackages = options.filter(
    (candidate) => candidate.active && !candidate.product
  );

  for (const candidate of activePackages) {
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

  const balances: readonly PackageBalance[] = activePackages.map(
    (candidate) => ({
      name: candidate.name,
      remaining: candidate.remaining,
      approved: configuredNames.has(
        normalizePackageNameForComparison(candidate.name)
      )
    })
  );
  const firstBalance = balances[0];
  if (firstBalance === undefined) return undefined;
  const nonEmptyBalances: NonEmptyPackageBalances = [
    firstBalance,
    ...balances.slice(1)
  ];

  for (const candidate of configured) {
    const option = activePackages.find(
      (observed) =>
        normalizePackageNameForComparison(observed.name) ===
          candidate.normalizedName && observed.remaining > 0
    );
    if (option !== undefined) {
      return {
        option,
        configuredName: candidate.name,
        balances: nonEmptyBalances
      };
    }
  }

  return undefined;
}
