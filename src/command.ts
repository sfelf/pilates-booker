import { readFile } from "node:fs/promises";
import { isAbsolute, win32 } from "node:path";

import {
  CLI_FAILURE_DIAGNOSTIC,
  runCli,
  type CliDependencies,
  type CliDiagnostic
} from "./cli.js";
import { loadPolicy } from "./policy.js";
import { validateRequest } from "./validation.js";

export type CommandArguments = Readonly<{
  runtimeDir: string;
  cliArguments: readonly string[];
}>;

export type CommandDependencies = Omit<CliDependencies, "baseDir">;

export const COMMAND_FAILURE_DIAGNOSTIC = CLI_FAILURE_DIAGNOSTIC;

export function reportCommandDiagnostic(diagnostic: CliDiagnostic): void {
  console.error(diagnostic);
}

function reportCommandFailure(
  reportDiagnostic: (diagnostic: CliDiagnostic) => void
): 30 {
  try {
    reportDiagnostic(COMMAND_FAILURE_DIAGNOSTIC);
  } catch {
    // A diagnostic transport failure cannot expose the underlying error.
  }
  return 30;
}

async function loadRequest(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

export const productionCommandDependencies: CommandDependencies = Object.freeze(
  {
    loadPolicy,
    loadRequest,
    validateRequest,
    reportDiagnostic: reportCommandDiagnostic
  }
);

export function parseCommandArguments(
  argv: readonly string[]
): CommandArguments | undefined {
  let runtimeDir: string | undefined;
  const cliArguments: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument !== "--runtime") {
      cliArguments.push(argument);
      continue;
    }
    const value = argv[index + 1];
    if (
      runtimeDir !== undefined ||
      value === undefined ||
      value === "" ||
      (!isAbsolute(value) && !win32.isAbsolute(value))
    ) {
      return undefined;
    }
    runtimeDir = value;
    index += 1;
  }

  return runtimeDir === undefined ? undefined : { runtimeDir, cliArguments };
}

export async function runCommand(
  argv: readonly string[],
  dependencies: CommandDependencies = productionCommandDependencies
): Promise<number> {
  const reportDiagnostic =
    dependencies.reportDiagnostic ?? reportCommandDiagnostic;
  const args = parseCommandArguments(argv);
  if (args === undefined) {
    return reportCommandFailure(reportDiagnostic);
  }
  try {
    return await runCli(args.cliArguments, {
      ...dependencies,
      baseDir: args.runtimeDir,
      reportDiagnostic
    });
  } catch {
    return reportCommandFailure(reportDiagnostic);
  }
}
