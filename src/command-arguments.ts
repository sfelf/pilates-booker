import { isAbsolute, win32 } from "node:path";

import { normalizePackageNameForComparison } from "./package-selection.js";
import { validateCheckoutUrl } from "./url-policy.js";
import type { BookingInput } from "./contracts.js";
import {
  resolveDefaultRuntime,
  type RuntimeEnvironment
} from "./runtime-paths.js";

export type CommandArguments = Readonly<{
  input: BookingInput;
  runtimeDir: string;
  debug: boolean;
}>;

export function parseCommandArguments(
  argv: readonly string[],
  environment: RuntimeEnvironment = {
    platform: process.platform,
    ...(process.env.HOME === undefined ? {} : { home: process.env.HOME }),
    ...(process.env.XDG_STATE_HOME === undefined
      ? {}
      : { xdgStateHome: process.env.XDG_STATE_HOME }),
    ...(process.env.LOCALAPPDATA === undefined
      ? {}
      : { localAppData: process.env.LOCALAPPDATA })
  }
): CommandArguments | undefined {
  let bookingUrl: string | undefined;
  const allowedPackages: string[] = [];
  const normalizedPackages = new Set<string>();
  let bookOnly = false;
  let dryRun = false;
  let runtimeDir: string | undefined;
  let debug = false;

  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === undefined) return undefined;
    if (
      option === "--book-only" ||
      option === "--dry-run" ||
      option === "--debug"
    ) {
      if (
        (option === "--book-only" && bookOnly) ||
        (option === "--dry-run" && dryRun) ||
        (option === "--debug" && debug)
      ) {
        return undefined;
      }
      if (option === "--book-only") bookOnly = true;
      if (option === "--dry-run") dryRun = true;
      if (option === "--debug") debug = true;
      continue;
    }

    if (
      option !== "--booking-url" &&
      option !== "--allow-package" &&
      option !== "--runtime"
    ) {
      return undefined;
    }
    const value = argv[index + 1];
    if (value === undefined || value === "" || value.startsWith("--")) {
      return undefined;
    }
    index += 1;

    if (option === "--booking-url") {
      if (bookingUrl !== undefined) return undefined;
      bookingUrl = value;
    } else if (option === "--allow-package") {
      const normalized = normalizePackageNameForComparison(value);
      if (normalized === "" || normalizedPackages.has(normalized)) {
        return undefined;
      }
      allowedPackages.push(value);
      normalizedPackages.add(normalized);
    } else {
      if (
        runtimeDir !== undefined ||
        (!isAbsolute(value) && !win32.isAbsolute(value))
      ) {
        return undefined;
      }
      runtimeDir = value;
    }
  }

  if (bookingUrl === undefined || allowedPackages.length === 0) {
    return undefined;
  }
  try {
    validateCheckoutUrl(bookingUrl);
    runtimeDir ??= resolveDefaultRuntime(environment);
  } catch {
    return undefined;
  }

  return {
    input: {
      booking_url: bookingUrl,
      allowed_packages: allowedPackages as [string, ...string[]],
      permitted_actions: bookOnly ? ["book"] : ["book", "waitlist"],
      dry_run: dryRun
    },
    runtimeDir,
    debug
  };
}
