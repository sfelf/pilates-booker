export type RuntimeEnvironment = Readonly<{
  platform: string;
  home?: string;
  xdgStateHome?: string;
  localAppData?: string;
}>;

export type RuntimePathsV2 = Readonly<{
  baseDir: string;
  profileDir: string;
  lockFile: string;
  logFile: string;
  rotatedLogFile: string;
}>;

export function resolveDefaultRuntime(
  _environment: RuntimeEnvironment
): string {
  const environment = _environment;
  let selected: string | undefined;
  if (environment.platform === "darwin" && environment.home !== undefined) {
    selected = posix.join(
      environment.home,
      "Library",
      "Application Support",
      "Pilates Booker"
    );
  } else if (
    environment.platform === "linux" &&
    environment.xdgStateHome !== undefined
  ) {
    selected = posix.join(environment.xdgStateHome, "pilates-booker");
  } else if (
    environment.platform === "linux" &&
    environment.home !== undefined
  ) {
    selected = posix.join(
      environment.home,
      ".local",
      "state",
      "pilates-booker"
    );
  } else if (
    environment.platform === "win32" &&
    environment.localAppData !== undefined
  ) {
    selected = win32.join(environment.localAppData, "Pilates Booker");
  }

  if (
    selected === undefined ||
    (!isAbsolute(selected) && !win32.isAbsolute(selected))
  ) {
    throw new Error("runtime base must be absolute");
  }
  return selected;
}

export function resolveRuntimePaths(base: string): RuntimePathsV2 {
  if (!isAbsolute(base) && !win32.isAbsolute(base)) {
    throw new Error("runtime base must be absolute");
  }
  const pathApi =
    !isAbsolute(base) && win32.isAbsolute(base) ? win32 : { join, resolve };
  const baseDir = pathApi.resolve(base);
  return {
    baseDir,
    profileDir: pathApi.join(baseDir, "Profile"),
    lockFile: pathApi.join(baseDir, "run.lock"),
    logFile: pathApi.join(baseDir, "pilates-booker.log"),
    rotatedLogFile: pathApi.join(baseDir, "pilates-booker.log.1")
  };
}
import { isAbsolute, join, posix, resolve, win32 } from "node:path";
