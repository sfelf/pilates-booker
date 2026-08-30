import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

const canonicalUuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

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
  requestId?: string
): RuntimePaths {
  const requested =
    base ??
    join(homedir(), "Library", "Application Support", "Arketa Automation");
  if (!isAbsolute(requested)) {
    throw new Error("runtime base must be absolute");
  }
  if (requestId !== undefined && !canonicalUuid.test(requestId)) {
    throw new Error("request ID must be a canonical UUID");
  }
  const baseDir = resolve(requested);
  const evidenceFile =
    requestId === undefined ? "current.json" : `${requestId}.json`;
  return {
    baseDir,
    profileDir: join(baseDir, "Profile"),
    lockFile: join(baseDir, "run.lock"),
    journalFile: join(baseDir, "journals", evidenceFile),
    resultFile: join(baseDir, "results", evidenceFile),
    logFile: join(baseDir, "logs", "current.log")
  };
}
