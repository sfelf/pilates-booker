import { win32 } from "node:path";

import { describe, expect, test } from "vitest";

import { parseCommandArguments } from "../src/command-arguments.js";

const checkoutUrl =
  "https://app.arketa.co/iframe/example/calendar/checkout/FAKE_CHECKOUT_ID";
const calendarUrl = "https://app.arketa.co/iframe/example/calendar";
const runtimeDir = "/private/pilates-runtime";
const environment = {
  platform: "darwin",
  home: "/Users/synthetic"
} as const;

describe("parseCommandArguments", () => {
  test("preserves package preference order and explicit options", () => {
    expect(
      parseCommandArguments(
        [
          "--booking-url",
          checkoutUrl,
          "--allow-package",
          "Synthetic 10 Class Pack",
          "--allow-package",
          "Synthetic 5 Class Pack",
          "--book-only",
          "--dry-run",
          "--runtime",
          runtimeDir,
          "--debug"
        ],
        environment
      )
    ).toEqual({
      input: {
        entry_mode: "checkout",
        booking_url: checkoutUrl,
        allowed_packages: ["Synthetic 10 Class Pack", "Synthetic 5 Class Pack"],
        permitted_actions: ["book"],
        dry_run: true
      },
      runtimeDir,
      debug: true
    });
  });

  test("defaults to live booking and waitlisting in the platform runtime", () => {
    expect(
      parseCommandArguments(
        [
          "--booking-url",
          checkoutUrl,
          "--allow-package",
          "Synthetic 10 Class Pack"
        ],
        environment
      )
    ).toEqual({
      input: {
        entry_mode: "checkout",
        booking_url: checkoutUrl,
        allowed_packages: ["Synthetic 10 Class Pack"],
        permitted_actions: ["book", "waitlist"],
        dry_run: false
      },
      runtimeDir: "/Users/synthetic/Library/Application Support/Pilates Booker",
      debug: false
    });
  });

  test("accepts an absolute Windows runtime on every host", () => {
    const windowsRuntime = win32.join(
      "C:\\",
      "Users",
      "Synthetic",
      "Pilates Booker"
    );
    expect(
      parseCommandArguments(
        [
          "--booking-url",
          checkoutUrl,
          "--allow-package",
          "Synthetic Pack",
          "--runtime",
          windowsRuntime
        ],
        environment
      )?.runtimeDir
    ).toBe(windowsRuntime);
  });

  test("accepts the complete calendar discovery mode", () => {
    expect(
      parseCommandArguments(
        [
          "--calendar-url",
          calendarUrl,
          "--class-name",
          "Synthetic Reformer",
          "--class-date",
          "2026-09-30",
          "--class-time",
          "16:30",
          "--allow-package",
          "Synthetic Pack",
          "--book-only",
          "--dry-run",
          "--runtime",
          runtimeDir,
          "--debug"
        ],
        environment
      )
    ).toEqual({
      input: {
        entry_mode: "calendar",
        calendar_url: calendarUrl,
        class_name: "Synthetic Reformer",
        class_date: "2026-09-30",
        class_time: "16:30",
        allowed_packages: ["Synthetic Pack"],
        permitted_actions: ["book"],
        dry_run: true
      },
      runtimeDir,
      debug: true
    });
  });

  test("preserves printable class-name text for later comparison", () => {
    expect(
      parseCommandArguments(
        [
          "--calendar-url",
          calendarUrl,
          "--class-name",
          "  ⭐ Synthetic Reformer ⭐  ",
          "--class-date",
          "2026-09-30",
          "--class-time",
          "16:30",
          "--allow-package",
          "Synthetic Pack"
        ],
        environment
      )?.input
    ).toMatchObject({
      entry_mode: "calendar",
      class_name: "  ⭐ Synthetic Reformer ⭐  "
    });
  });

  test.each([
    ["missing booking URL", ["--allow-package", "Synthetic Pack"]],
    [
      "missing discovery mode",
      ["--calendar-url", calendarUrl, "--allow-package", "Synthetic Pack"]
    ],
    [
      "partial discovery mode",
      [
        "--calendar-url",
        calendarUrl,
        "--class-name",
        "Synthetic Reformer",
        "--class-date",
        "2026-09-30",
        "--allow-package",
        "Synthetic Pack"
      ]
    ],
    [
      "discovery fields without calendar URL",
      [
        "--class-name",
        "Synthetic Reformer",
        "--class-date",
        "2026-09-30",
        "--class-time",
        "16:30",
        "--allow-package",
        "Synthetic Pack"
      ]
    ],
    [
      "mixed entry modes",
      [
        "--booking-url",
        checkoutUrl,
        "--calendar-url",
        calendarUrl,
        "--class-name",
        "Synthetic Reformer",
        "--class-date",
        "2026-09-30",
        "--class-time",
        "16:30",
        "--allow-package",
        "Synthetic Pack"
      ]
    ],
    [
      "repeated calendar URL",
      [
        "--calendar-url",
        calendarUrl,
        "--calendar-url",
        calendarUrl,
        "--class-name",
        "Synthetic Reformer",
        "--class-date",
        "2026-09-30",
        "--class-time",
        "16:30",
        "--allow-package",
        "Synthetic Pack"
      ]
    ],
    [
      "repeated class name",
      [
        "--calendar-url",
        calendarUrl,
        "--class-name",
        "Synthetic Reformer",
        "--class-name",
        "Synthetic Reformer",
        "--class-date",
        "2026-09-30",
        "--class-time",
        "16:30",
        "--allow-package",
        "Synthetic Pack"
      ]
    ],
    [
      "repeated class date",
      [
        "--calendar-url",
        calendarUrl,
        "--class-name",
        "Synthetic Reformer",
        "--class-date",
        "2026-09-30",
        "--class-date",
        "2026-09-30",
        "--class-time",
        "16:30",
        "--allow-package",
        "Synthetic Pack"
      ]
    ],
    [
      "repeated class time",
      [
        "--calendar-url",
        calendarUrl,
        "--class-name",
        "Synthetic Reformer",
        "--class-date",
        "2026-09-30",
        "--class-time",
        "16:30",
        "--class-time",
        "16:30",
        "--allow-package",
        "Synthetic Pack"
      ]
    ],
    [
      "repeated booking URL",
      [
        "--booking-url",
        checkoutUrl,
        "--booking-url",
        checkoutUrl,
        "--allow-package",
        "Synthetic Pack"
      ]
    ],
    ["missing package", ["--booking-url", checkoutUrl]],
    ["empty package", ["--booking-url", checkoutUrl, "--allow-package", ""]],
    [
      "normalized-empty package",
      ["--booking-url", checkoutUrl, "--allow-package", " ⭐ "]
    ],
    [
      "duplicate package",
      [
        "--booking-url",
        checkoutUrl,
        "--allow-package",
        "Synthetic Pack",
        "--allow-package",
        "Synthetic Pack"
      ]
    ],
    [
      "normalized duplicate package",
      [
        "--booking-url",
        checkoutUrl,
        "--allow-package",
        "Synthetic Pack",
        "--allow-package",
        " ⭐ Synthetic   Pack ⭐ "
      ]
    ],
    [
      "repeated book-only",
      [
        "--booking-url",
        checkoutUrl,
        "--allow-package",
        "Synthetic Pack",
        "--book-only",
        "--book-only"
      ]
    ],
    [
      "repeated dry-run",
      [
        "--booking-url",
        checkoutUrl,
        "--allow-package",
        "Synthetic Pack",
        "--dry-run",
        "--dry-run"
      ]
    ],
    [
      "repeated debug",
      [
        "--booking-url",
        checkoutUrl,
        "--allow-package",
        "Synthetic Pack",
        "--debug",
        "--debug"
      ]
    ],
    [
      "relative runtime",
      [
        "--booking-url",
        checkoutUrl,
        "--allow-package",
        "Synthetic Pack",
        "--runtime",
        "runtime"
      ]
    ],
    ["missing option value", ["--booking-url", checkoutUrl, "--allow-package"]],
    [
      "unknown option",
      [
        "--booking-url",
        checkoutUrl,
        "--allow-package",
        "Synthetic Pack",
        "--unknown"
      ]
    ],
    [
      "positional argument",
      [
        "--booking-url",
        checkoutUrl,
        "--allow-package",
        "Synthetic Pack",
        "request.json"
      ]
    ],
    [
      "unsafe checkout URL",
      [
        "--booking-url",
        `${checkoutUrl}?token=private`,
        "--allow-package",
        "Synthetic Pack"
      ]
    ],
    [
      "invalid calendar URL",
      [
        "--calendar-url",
        "https://evil.example/iframe/synthetic/calendar",
        "--class-name",
        "Synthetic Reformer",
        "--class-date",
        "2026-09-30",
        "--class-time",
        "16:30",
        "--allow-package",
        "Synthetic Pack"
      ]
    ],
    [
      "impossible class date",
      [
        "--calendar-url",
        calendarUrl,
        "--class-name",
        "Synthetic Reformer",
        "--class-date",
        "2026-02-30",
        "--class-time",
        "16:30",
        "--allow-package",
        "Synthetic Pack"
      ]
    ],
    [
      "noncanonical class date",
      [
        "--calendar-url",
        calendarUrl,
        "--class-name",
        "Synthetic Reformer",
        "--class-date",
        "2026-9-30",
        "--class-time",
        "16:30",
        "--allow-package",
        "Synthetic Pack"
      ]
    ],
    [
      "noncanonical class time",
      [
        "--calendar-url",
        calendarUrl,
        "--class-name",
        "Synthetic Reformer",
        "--class-date",
        "2026-09-30",
        "--class-time",
        "4:30",
        "--allow-package",
        "Synthetic Pack"
      ]
    ],
    [
      "normalized-empty class name",
      [
        "--calendar-url",
        calendarUrl,
        "--class-name",
        " ⭐ ",
        "--class-date",
        "2026-09-30",
        "--class-time",
        "16:30",
        "--allow-package",
        "Synthetic Pack"
      ]
    ],
    [
      "empty class name",
      [
        "--calendar-url",
        calendarUrl,
        "--class-name",
        "",
        "--class-date",
        "2026-09-30",
        "--class-time",
        "16:30",
        "--allow-package",
        "Synthetic Pack"
      ]
    ],
    [
      "unsafe class name",
      [
        "--calendar-url",
        calendarUrl,
        "--class-name",
        "Synthetic\nReformer",
        "--class-date",
        "2026-09-30",
        "--class-time",
        "16:30",
        "--allow-package",
        "Synthetic Pack"
      ]
    ]
  ] as const)("rejects %s", (_name, argv) => {
    expect(parseCommandArguments(argv, environment)).toBeUndefined();
  });
});
