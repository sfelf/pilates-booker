import type { DebugException } from "./debug-log.js";

const diagnosticBoundaries = new Set([
  "BookingPageError",
  "BookingPageControlError"
]);

export function projectDebugException(error: unknown): DebugException {
  if (!(error instanceof Error)) return { name: "Error" };
  if (
    !diagnosticBoundaries.has(error.name) &&
    error.cause instanceof Error
  ) {
    return projectDebugException(error.cause);
  }
  return {
    name: error.name,
    message: error.message,
    ...(error.stack === undefined ? {} : { stack: error.stack })
  };
}
