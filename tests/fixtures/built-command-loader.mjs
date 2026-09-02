import { URL } from "node:url";

const bookingPageUrl = new URL("../../dist/booking-page.js", import.meta.url)
  .href;
const fixtureUrl = new URL("./built-command-browser.mjs", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  const resolved = await nextResolve(specifier, context);
  return resolved.url === bookingPageUrl
    ? { ...resolved, shortCircuit: true, url: fixtureUrl }
    : resolved;
}
