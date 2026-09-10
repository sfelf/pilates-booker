import { readFile, writeFile } from "node:fs/promises";
import { URL } from "node:url";

const packageMetadata = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8")
);

if (typeof packageMetadata.version !== "string") {
  throw new Error("Package version must be a string.");
}

await writeFile(
  new URL("../dist/version.json", import.meta.url),
  `${JSON.stringify({ version: packageMetadata.version })}\n`,
  "utf8"
);
