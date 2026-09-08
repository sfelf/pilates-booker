import { isAbsolute, win32 } from "node:path";

import { normalizePackageNameForComparison } from "./package-selection.js";
import { projectSafeText } from "./safe-text.js";
import { validateCalendarPageUrl, validateCheckoutUrl } from "./url-policy.js";
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

const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const CALENDAR_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

function isValidCalendarDate(value: string): boolean {
  const match = CALENDAR_DATE_PATTERN.exec(value);
  if (match === null) return false;

  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) &&
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() + 1 === Number(match[2]) &&
    date.getUTCDate() === Number(match[3])
  );
}

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
  let calendarUrl: string | undefined;
  let className: string | undefined;
  let classDate: string | undefined;
  let classTime: string | undefined;
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
      option !== "--calendar-url" &&
      option !== "--class-name" &&
      option !== "--class-date" &&
      option !== "--class-time" &&
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
    } else if (option === "--calendar-url") {
      if (calendarUrl !== undefined) return undefined;
      calendarUrl = value;
    } else if (option === "--class-name") {
      if (className !== undefined) return undefined;
      className = value;
    } else if (option === "--class-date") {
      if (classDate !== undefined) return undefined;
      classDate = value;
    } else if (option === "--class-time") {
      if (classTime !== undefined) return undefined;
      classTime = value;
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

  if (allowedPackages.length === 0) {
    return undefined;
  }
  try {
    const hasDiscoveryOption =
      calendarUrl !== undefined ||
      className !== undefined ||
      classDate !== undefined ||
      classTime !== undefined;

    let input: BookingInput;
    if (bookingUrl !== undefined) {
      if (hasDiscoveryOption) return undefined;
      validateCheckoutUrl(bookingUrl);
      input = {
        entry_mode: "checkout",
        booking_url: bookingUrl,
        allowed_packages: allowedPackages as [string, ...string[]],
        permitted_actions: bookOnly ? ["book"] : ["book", "waitlist"],
        dry_run: dryRun
      };
    } else {
      if (
        calendarUrl === undefined ||
        className === undefined ||
        classDate === undefined ||
        classTime === undefined ||
        !validateCalendarPageUrl(calendarUrl) ||
        projectSafeText(className) !== className ||
        normalizePackageNameForComparison(className) === "" ||
        !isValidCalendarDate(classDate) ||
        !CALENDAR_TIME_PATTERN.test(classTime)
      ) {
        return undefined;
      }
      input = {
        entry_mode: "calendar",
        calendar_url: calendarUrl,
        class_name: className,
        class_date: classDate,
        class_time: classTime,
        allowed_packages: allowedPackages as [string, ...string[]],
        permitted_actions: bookOnly ? ["book"] : ["book", "waitlist"],
        dry_run: dryRun
      };
    }

    runtimeDir ??= resolveDefaultRuntime(environment);

    return { input, runtimeDir, debug };
  } catch {
    return undefined;
  }
}
