import { createRequire } from "node:module";

type PackageMetadata = Readonly<{ version: string }>;

const versionMetadataSpecifier = import.meta.url.endsWith(".ts")
  ? "../package.json"
  : "./version.json";
const packageMetadata = createRequire(import.meta.url)(
  versionMetadataSpecifier
) as PackageMetadata;
export const APPLICATION_VERSION = packageMetadata.version;
