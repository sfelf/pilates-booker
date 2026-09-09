import * as module from "node:module";
import { URL } from "node:url";

if (typeof module.registerHooks === "function") {
  const bookingPageUrl = new URL("../../dist/booking-page.js", import.meta.url)
    .href;
  const fixtureUrl = new URL("./built-command-browser.mjs", import.meta.url)
    .href;
  module.registerHooks({
    resolve(specifier, context, nextResolve) {
      const resolved = nextResolve(specifier, context);
      return resolved.url === bookingPageUrl
        ? { ...resolved, shortCircuit: true, url: fixtureUrl }
        : resolved;
    }
  });
} else {
  module.register("./built-command-loader.mjs", import.meta.url);
}
