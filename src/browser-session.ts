import { isAbsolute } from "node:path";

import { chromium, type Page } from "playwright";

type PersistentContextOptions = NonNullable<
  Parameters<typeof chromium.launchPersistentContext>[1]
>;

export type BrowserContextLike = Readonly<{
  pages(): readonly Page[];
  newPage(): Promise<Page>;
  close(): Promise<void>;
}>;

export type PersistentBrowserLauncher = (
  profileDir: string,
  options: PersistentContextOptions
) => Promise<BrowserContextLike>;

const launchPersistentBrowser: PersistentBrowserLauncher = (
  profileDir,
  options
) => chromium.launchPersistentContext(profileDir, options);

export async function withPersistentBrowser<T>(
  profileDir: string,
  use: (context: BrowserContextLike) => Promise<T>,
  launcher: PersistentBrowserLauncher = launchPersistentBrowser
): Promise<T> {
  if (!isAbsolute(profileDir)) {
    throw new Error("profile path must be absolute");
  }

  const context = await launcher(profileDir, { headless: false });
  try {
    return await use(context);
  } finally {
    await context.close();
  }
}
