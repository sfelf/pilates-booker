try {
  const { runCommand } = await import("./command.js");
  process.exitCode = await runCommand(process.argv.slice(2));
} catch {
  const mainFailureDiagnostic = "Booking command failed.";
  console.error(mainFailureDiagnostic);
  process.exitCode = 30;
}
