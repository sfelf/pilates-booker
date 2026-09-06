import { URL } from "node:url";

const mainUrl = new URL("../../dist/main.js", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (context.parentURL === mainUrl && specifier === "./command.js") {
    throw new Error(
      "synthetic private bootstrap failure at /private/bootstrap/location"
    );
  }
  return nextResolve(specifier, context);
}
