import { createRequire } from "node:module";

type PackageMetadata = Readonly<{ version: string }>;

const packageMetadata = createRequire(import.meta.url)(
  "../package.json"
) as PackageMetadata;
export const APPLICATION_VERSION = packageMetadata.version;
