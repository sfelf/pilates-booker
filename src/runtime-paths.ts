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

export function resolveRuntimePaths(base?: string): RuntimePaths {
  const requested =
    base ??
    join(homedir(), "Library", "Application Support", "Arketa Automation");
  if (!isAbsolute(requested)) {
    throw new Error("runtime base must be absolute");
  }
  const baseDir = resolve(requested);
  return {
    baseDir,
    profileDir: join(baseDir, "Profile"),
    lockFile: join(baseDir, "run.lock"),
    journalFile: join(baseDir, "journals", "current.json"),
    resultFile: join(baseDir, "results", "current.json"),
    logFile: join(baseDir, "logs", "current.log")
  };
}
