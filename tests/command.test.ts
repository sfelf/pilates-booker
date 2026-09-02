import { expect, it, vi } from "vitest";

import { COMMAND_FAILURE_DIAGNOSTIC, runCommand } from "../src/command.js";

const checkoutUrl =
  "https://app.arketa.co/iframe/synthetic/calendar/checkout/command";

it("passes the validated public arguments to one workflow invocation", async () => {
  const execute = vi.fn(
    async (context: { advance(stage: "VALIDATED"): Promise<void> }) => {
      await context.advance("VALIDATED");
      return {
        schema_version: 2 as const,
        outcome: "SAFE_STOP" as const,
        exit_code: 20 as const,
        action_submitted: false as const,
        confirmation_verified: false as const,
        safety_checks: {
          approved_package_verified: false as const,
          no_charge: false as const,
          cancellation_policy_accepted: false as const
        },
        details: "Booking stopped safely." as const
      };
    }
  );
  const emitResult = vi.fn(async () => undefined);
  const acquireLock = vi.fn(async () => ({
    release: async () => ({ released: true as const })
  }));

  expect(
    await runCommand(
      [
        "--booking-url",
        checkoutUrl,
        "--allow-package",
        "First Pack",
        "--allow-package",
        "Second Pack",
        "--runtime",
        "/private/runtime",
        "--book-only"
      ],
      { execute, emitResult, acquireLock }
    )
  ).toBe(20);
  expect(execute).toHaveBeenCalledOnce();
  const calls = execute.mock.calls as unknown as readonly [
    readonly [{ input: unknown }]
  ];
  expect(calls[0][0].input).toEqual({
    booking_url: checkoutUrl,
    allowed_packages: ["First Pack", "Second Pack"],
    permitted_actions: ["book"],
    dry_run: false
  });
});

it("rejects invalid arguments before acquiring the runtime lock", async () => {
  const acquireLock = vi.fn();
  const reportDiagnostic = vi.fn();
  expect(
    await runCommand(["--unknown"], { acquireLock, reportDiagnostic })
  ).toBe(30);
  expect(acquireLock).not.toHaveBeenCalled();
  expect(reportDiagnostic).toHaveBeenCalledWith(COMMAND_FAILURE_DIAGNOSTIC);
});
