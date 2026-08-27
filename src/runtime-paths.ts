import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export type RuntimePaths = Readonly<{
  baseDir: string;
  profileDir: string;
  lockFile: string;
  journalFile: string;
  resultFile: string;
  logFile: string;
}>;

export function resolveRuntimePaths(
  base?: string,
  requestId = "current"
): RuntimePaths {
  const requested =
    base ??
    join(homedir(), "Library", "Application Support", "Arketa Automation");
  if (!isAbsolute(requested)) {
    throw new Error("runtime base must be absolute");
  }
  const baseDir = resolve(requested);
  if (
    requestId !== "current" &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      requestId
    )
  ) {
    throw new Error("runtime request ID must be a canonical UUID");
  }
  return {
    baseDir,
    profileDir: join(baseDir, "Profile"),
    lockFile: join(baseDir, "run.lock"),
    journalFile: join(baseDir, "journals", `${requestId}.json`),
    resultFile: join(baseDir, "results", `${requestId}.json`),
    logFile: join(baseDir, "logs", "current.log")
  };
}
