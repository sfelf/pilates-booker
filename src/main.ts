try {
  const { runCommand } = await import("./command.js");
  process.exitCode = await runCommand(process.argv.slice(2));
} catch {
  console.error("Booking command failed.");
  process.exitCode = 30;
}
