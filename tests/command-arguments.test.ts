import { win32 } from "node:path";

import { describe, expect, test } from "vitest";

import { parseCommandArguments } from "../src/command-arguments.js";

const checkoutUrl =
  "https://app.arketa.co/iframe/example/calendar/checkout/FAKE_CHECKOUT_ID";
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

  test.each([
    ["missing booking URL", ["--allow-package", "Synthetic Pack"]],
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
    ]
  ] as const)("rejects %s", (_name, argv) => {
    expect(parseCommandArguments(argv, environment)).toBeUndefined();
  });
});
