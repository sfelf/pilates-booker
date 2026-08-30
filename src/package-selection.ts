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

export type PackageDecision = Readonly<{
  balances: readonly PackageBalance[];
  selection: PackageSelection | null;
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

export function decidePackage(
  policy: BookingPolicy,
  options: readonly PackageOption[]
): PackageDecision | undefined {
  const configuredByNormalizedName = new Map<string, string>();
  const configured = [] as { name: string; normalizedName: string }[];
  for (const name of policy.allowed_packages) {
    const normalizedName = normalizePackageNameForComparison(name);
    if (
      normalizedName === "" ||
      configuredByNormalizedName.has(normalizedName)
    ) {
      return undefined;
    }
    configuredByNormalizedName.set(normalizedName, name);
    configured.push({ name, normalizedName });
  }
  const activePackages = options.filter(
    (candidate) => candidate.active && !candidate.product
  );

  for (const candidate of activePackages) {
    if (!Number.isSafeInteger(candidate.remaining) || candidate.remaining < 0) {
      return undefined;
    }
  }

  const positivePackages = activePackages.filter(
    (candidate) => candidate.remaining > 0
  );
  const normalizedNames = new Set<string>();
  for (const candidate of positivePackages) {
    const normalizedName = normalizePackageNameForComparison(candidate.name);
    if (normalizedName === "" || normalizedNames.has(normalizedName)) {
      return undefined;
    }
    normalizedNames.add(normalizedName);
  }

  const balances: readonly PackageBalance[] = positivePackages.map(
    (candidate) => {
      const normalizedName = normalizePackageNameForComparison(candidate.name);
      const configuredName = configuredByNormalizedName.get(normalizedName);
      return {
        name: configuredName ?? normalizedName,
        remaining: candidate.remaining,
        approved: configuredName !== undefined
      };
    }
  );
  const firstBalance = balances[0];
  if (firstBalance === undefined) {
    return { balances, selection: null };
  }
  const nonEmptyBalances: NonEmptyPackageBalances = [
    firstBalance,
    ...balances.slice(1)
  ];

  for (const candidate of configured) {
    const option = positivePackages.find(
      (observed) =>
        normalizePackageNameForComparison(observed.name) ===
          candidate.normalizedName && observed.remaining > 0
    );
    if (option !== undefined) {
      return {
        balances,
        selection: {
          option,
          configuredName: candidate.name,
          balances: nonEmptyBalances
        }
      };
    }
  }

  return { balances, selection: null };
}

export function choosePackage(
  policy: BookingPolicy,
  options: readonly PackageOption[]
): PackageSelection | undefined {
  return decidePackage(policy, options)?.selection ?? undefined;
}
