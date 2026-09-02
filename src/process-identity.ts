import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";

export type ProcessIdentityResult =
  | Readonly<{ kind: "found"; identity: string }>
  | Readonly<{ kind: "absent" }>
  | Readonly<{ kind: "unknown" }>;

export type ProcessIdentityProvider = Readonly<{
  identify(pid: number): Promise<ProcessIdentityResult>;
}>;

type CommandResult =
  | Readonly<{ kind: "ok"; stdout: string }>
  | Readonly<{ kind: "absent" }>
  | Readonly<{ kind: "unknown" }>;

type ProcessIdentityDependencies = Readonly<{
  readFile?(path: string, encoding: "utf8"): Promise<string>;
  run?(command: string, args: readonly string[]): Promise<CommandResult>;
  probe?(
    pid: number
  ): Promise<Readonly<{ kind: "active" | "absent" | "unknown" }>>;
}>;

export function createProcessIdentityProvider(
  platform: NodeJS.Platform = process.platform,
  dependencies: ProcessIdentityDependencies = {}
): ProcessIdentityProvider {
  if (platform === "linux") {
    const read = dependencies.readFile ?? readFile;
    return {
      async identify(pid) {
        try {
          const contents = await read(`/proc/${pid}/stat`, "utf8");
          const closingParenthesis = contents.lastIndexOf(")");
          if (closingParenthesis < 0) return { kind: "unknown" };
          const fields = contents
            .slice(closingParenthesis + 1)
            .trim()
            .split(/\s+/u);
          const startTicks = fields[19];
          return startTicks !== undefined && /^\d+$/u.test(startTicks)
            ? { kind: "found", identity: `linux:${startTicks}` }
            : { kind: "unknown" };
        } catch (error) {
          return (error as NodeJS.ErrnoException).code === "ENOENT"
            ? { kind: "absent" }
            : { kind: "unknown" };
        }
      }
    };
  }

  if (platform === "darwin") {
    const run = dependencies.run ?? runDarwinProcessQuery;
    const probe = dependencies.probe ?? probeProcess;
    return {
      async identify(pid) {
        let result: CommandResult;
        try {
          result = await run("/bin/ps", ["-p", String(pid), "-o", "lstart="]);
        } catch {
          return { kind: "unknown" };
        }
        if (result.kind === "absent") return result;
        if (result.kind === "unknown") {
          const probeResult = await probe(pid).catch(() => ({
            kind: "unknown" as const
          }));
          return probeResult.kind === "absent"
            ? { kind: "absent" }
            : { kind: "unknown" };
        }
        const value = result.stdout.replace(/\s+/gu, " ").trim();
        const epochSeconds = parseDarwinStart(value);
        return epochSeconds === undefined
          ? { kind: "unknown" }
          : { kind: "found", identity: `darwin:${epochSeconds}` };
      }
    };
  }

  if (platform === "win32") {
    const run = dependencies.run ?? runWindowsProcessQuery;
    return {
      async identify(pid) {
        let result: CommandResult;
        try {
          result = await run("powershell.exe", [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            windowsProcessQuery(pid)
          ]);
        } catch {
          return { kind: "unknown" };
        }
        if (result.kind !== "ok") return result;
        const value = result.stdout.trim();
        return /^\d+$/u.test(value)
          ? { kind: "found", identity: `win32:${value}` }
          : { kind: "unknown" };
      }
    };
  }

  return { identify: async () => ({ kind: "unknown" }) };
}

function runDarwinProcessQuery(
  command: string,
  args: readonly string[]
): Promise<CommandResult> {
  return runCommand(command, args, undefined, {
    ...process.env,
    LC_ALL: "C",
    TZ: "UTC"
  });
}

function runWindowsProcessQuery(
  command: string,
  args: readonly string[]
): Promise<CommandResult> {
  return runCommand(command, args, 3);
}

function runCommand(
  command: string,
  args: readonly string[],
  absentExitCode?: number,
  env?: NodeJS.ProcessEnv
): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(command, [...args], { encoding: "utf8", env }, (error, stdout) => {
      if (error === null) {
        resolve({ kind: "ok", stdout });
        return;
      }
      resolve(
        typeof error.code === "number" && error.code === absentExitCode
          ? { kind: "absent" }
          : { kind: "unknown" }
      );
    });
  });
}

async function probeProcess(
  pid: number
): Promise<Readonly<{ kind: "active" | "absent" | "unknown" }>> {
  try {
    process.kill(pid, 0);
    return { kind: "active" };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return { kind: "absent" };
    if (code === "EPERM") return { kind: "active" };
    return { kind: "unknown" };
  }
}

function parseDarwinStart(value: string): number | undefined {
  const match = value.match(
    /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/u
  );
  if (match === null) return undefined;
  const [
    ,
    weekday,
    monthName,
    dayText,
    hourText,
    minuteText,
    secondText,
    yearText
  ] = match;
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec"
  ];
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const month = months.indexOf(monthName ?? "");
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const year = Number(yearText);
  if (month < 0 || year < 1970) return undefined;
  const timestamp = Date.UTC(year, month, day, hour, minute, second);
  const date = new Date(timestamp);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second ||
    weekdays[date.getUTCDay()] !== weekday
  ) {
    return undefined;
  }
  return timestamp / 1000;
}

function windowsProcessQuery(pid: number): string {
  return `$ErrorActionPreference='Stop'; try { (Get-Process -Id ${pid}).StartTime.ToUniversalTime().Ticks } catch [Microsoft.PowerShell.Commands.ProcessCommandException] { exit 3 } catch { exit 4 }`;
}
