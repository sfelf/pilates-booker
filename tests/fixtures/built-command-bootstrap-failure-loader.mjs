import { writeFileSync } from "node:fs";
import { URL } from "node:url";

const mainUrl = new URL("../../dist/main.js", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (context.parentURL === mainUrl && specifier === "./command.js") {
    const markerPath = process.env.PILATES_BOOKER_BOOTSTRAP_FAILURE_MARKER;
    if (markerPath === undefined) {
      throw new Error("synthetic private bootstrap marker is missing");
    }
    writeFileSync(markerPath, "injected\n", { encoding: "utf8", flag: "wx" });
    throw new Error(
      "synthetic private bootstrap failure at /private/bootstrap/location"
    );
  }
  return nextResolve(specifier, context);
}
