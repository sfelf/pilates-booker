import { mkdir, open, rename, unlink } from "node:fs/promises";
import { basename, dirname, join, parse, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export type JsonValidator = (value: unknown) => boolean;

export type DurableDirectoryOperations = Readonly<{
  createDirectory(path: string): Promise<boolean>;
  syncDirectory(path: string): Promise<void>;
}>;

const directoryOperations: DurableDirectoryOperations = {
  async createDirectory(path) {
    try {
      await mkdir(path, { mode: 0o700 });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
  },
  async syncDirectory(path) {
    const handle = await open(path, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
};

export async function ensureDirectoryDurable(
  path: string,
  operations: DurableDirectoryOperations = directoryOperations
): Promise<void> {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  const segments = absolute.slice(root.length).split("/").filter(Boolean);
  let current = root;
  for (const segment of segments) {
    const child = join(current, segment);
    if (await operations.createDirectory(child)) {
      await operations.syncDirectory(current);
    }
    current = child;
  }
}

export async function syncDirectoryDurable(path: string): Promise<void> {
  await directoryOperations.syncDirectory(path);
}

export async function writeJsonAtomic(
  path: string,
  value: unknown,
  validate: JsonValidator = () => true
): Promise<void> {
  if (!validate(value)) {
    throw new Error("JSON validation failed");
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error("JSON serialization failed");
  }
  const representation: unknown = JSON.parse(serialized);
  if (!validate(representation)) {
    throw new Error("JSON validation failed after serialization");
  }

  const directory = dirname(path);
  await ensureDirectoryDurable(directory);
  const temporary = join(directory, `.${basename(path)}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${serialized}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
    await syncDirectoryDurable(directory);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}
