import type {
  BookingRequest,
  CheckoutAction,
  CheckoutObservation,
  ObservedClass,
  PackageBalance
} from "./contracts.js";

export type RawOffering =
  | Readonly<{ kind: "product"; name: string }>
  | Readonly<{
      kind: "class_package";
      name: string;
      remaining: number;
      active: boolean;
    }>;

export type RawCheckoutSnapshot = Readonly<{
  authenticated: boolean;
  login_required: boolean;
  classes: readonly ObservedClass[];
  actions: readonly CheckoutAction[];
  offerings: readonly RawOffering[];
}>;

export type CheckoutInspectionErrorCode =
  | "AMBIGUOUS_CHECKOUT_STATE"
  | "CLASS_MISMATCH";

export class CheckoutInspectionError extends Error {
  constructor(readonly code: CheckoutInspectionErrorCode) {
    super(
      code === "CLASS_MISMATCH"
        ? "Checkout class does not match the request."
        : "Checkout state is ambiguous."
    );
    this.name = "CheckoutInspectionError";
  }
}

export function inspectCheckoutSnapshot(
  request: BookingRequest,
  raw: RawCheckoutSnapshot
): CheckoutObservation {
  if (raw.authenticated === raw.login_required) {
    throw new CheckoutInspectionError("AMBIGUOUS_CHECKOUT_STATE");
  }

  if (raw.login_required) {
    if (
      raw.classes.length !== 0 ||
      raw.actions.length !== 0 ||
      raw.offerings.length !== 0
    ) {
      throw new CheckoutInspectionError("AMBIGUOUS_CHECKOUT_STATE");
    }
    return { status: "login_required" };
  }

  if (raw.classes.length !== 1 || raw.actions.length !== 1) {
    throw new CheckoutInspectionError("AMBIGUOUS_CHECKOUT_STATE");
  }

  const observedClass = raw.classes[0]!;
  const expectedClass = request.expected_class;
  if (
    observedClass.instructor.length === 0 ||
    !/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(observedClass.end_time)
  ) {
    throw new CheckoutInspectionError("AMBIGUOUS_CHECKOUT_STATE");
  }
  if (
    observedClass.name !== expectedClass.name ||
    observedClass.date !== expectedClass.date ||
    observedClass.start_time !== expectedClass.start_time ||
    observedClass.timezone !== expectedClass.timezone
  ) {
    throw new CheckoutInspectionError("CLASS_MISMATCH");
  }

  return {
    status: "observed",
    observed_class: observedClass,
    action: raw.actions[0]!,
    packages: inspectPackages(raw.offerings)
  };
}

function inspectPackages(
  offerings: RawCheckoutSnapshot["offerings"]
): readonly PackageBalance[] {
  const names = new Set<string>();
  const packages: PackageBalance[] = [];

  for (const offering of offerings) {
    if (offering.kind === "product" || !offering.active) continue;
    if (
      offering.name.length === 0 ||
      names.has(offering.name) ||
      !Number.isFinite(offering.remaining) ||
      !Number.isSafeInteger(offering.remaining) ||
      offering.remaining < 0
    ) {
      throw new CheckoutInspectionError("AMBIGUOUS_CHECKOUT_STATE");
    }
    names.add(offering.name);
    packages.push({
      name: offering.name,
      remaining: offering.remaining,
      approved: false
    });
  }

  return packages;
}
