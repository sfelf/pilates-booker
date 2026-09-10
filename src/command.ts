import { parseCommandArguments } from "./command-arguments.js";
import {
  CLI_FAILURE_DIAGNOSTIC,
  runCli,
  type CliDependencies,
  type CliDiagnostic
} from "./cli.js";
import { writeResultToStdout, type ResultEmitter } from "./result-output.js";
import { APPLICATION_VERSION } from "./version.js";

export type CommandDependencies = CliDependencies &
  Readonly<{ emitVersion?: ResultEmitter }>;
export const COMMAND_FAILURE_DIAGNOSTIC = CLI_FAILURE_DIAGNOSTIC;

export function reportCommandDiagnostic(diagnostic: CliDiagnostic): void {
  console.error(diagnostic);
}

export const productionCommandDependencies: CommandDependencies = Object.freeze(
  {
    emitVersion: writeResultToStdout,
    reportDiagnostic: reportCommandDiagnostic
  }
);

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

export async function runCommand(
  argv: readonly string[],
  dependencies: CommandDependencies = productionCommandDependencies
): Promise<number> {
  const reportDiagnostic =
    dependencies.reportDiagnostic ?? reportCommandDiagnostic;
  if (argv.length === 1 && argv[0] === "--version") {
    try {
      await (dependencies.emitVersion ?? writeResultToStdout)(
        `pilates-booker ${APPLICATION_VERSION}\n`
      );
      return 0;
    } catch {
      return reportCommandFailure(reportDiagnostic);
    }
  }
  const args = parseCommandArguments(argv);
  if (args === undefined) return reportCommandFailure(reportDiagnostic);
  try {
    return await runCli(args, { ...dependencies, reportDiagnostic });
  } catch {
    return reportCommandFailure(reportDiagnostic);
  }
}
