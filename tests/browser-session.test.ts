import type { Page } from "playwright";
import { describe, expect, it } from "vitest";

import {
  withPersistentBrowser,
  type BrowserContextLike,
  type PersistentBrowserLauncher
} from "../src/browser-session.js";

function recordingLauncher() {
  const launches: { profileDir: string; options: unknown }[] = [];
  let closes = 0;
  const page = {} as Page;
  const context: BrowserContextLike = {
    pages: () => [page],
    newPage: async () => page,
    close: async () => {
      closes += 1;
    }
  };
  const launcher: PersistentBrowserLauncher = async (profileDir, options) => {
    launches.push({ profileDir, options });
    return context;
  };
  return {
    launcher,
    launches,
    get closes() {
      return closes;
    },
    context
  };
}

describe("withPersistentBrowser", () => {
  it("uses the exact legitimate profile path and returns callback output", async () => {
    const recording = recordingLauncher();
    const profileDir = "/tmp/Pilates Profiles/Élodie/Profile";

    const result = await withPersistentBrowser(
      profileDir,
      async (context) => (context === recording.context ? "observed" : "wrong"),
      recording.launcher
    );

    expect(result).toBe("observed");
    expect(recording.launches).toEqual([
      { profileDir, options: { headless: false } }
    ]);
    expect(recording.closes).toBe(1);
  });

  it("closes the context when the callback fails", async () => {
    const recording = recordingLauncher();

    await expect(
      withPersistentBrowser(
        "/tmp/profile",
        async () => {
          throw new Error("external private value");
        },
        recording.launcher
      )
    ).rejects.toThrow("external private value");
    expect(recording.closes).toBe(1);
  });

  it("does not attempt close when launch fails", async () => {
    let callbackCalled = false;
    const launcher: PersistentBrowserLauncher = async () => {
      throw new Error("launch failed");
    };

    await expect(
      withPersistentBrowser(
        "/tmp/profile",
        async () => {
          callbackCalled = true;
        },
        launcher
      )
    ).rejects.toThrow("launch failed");
    expect(callbackCalled).toBe(false);
  });

  it("rejects relative profile paths before launching", async () => {
    const recording = recordingLauncher();

    await expect(
      withPersistentBrowser(
        "relative/profile",
        async () => undefined,
        recording.launcher
      )
    ).rejects.toThrow("profile path must be absolute");
    expect(recording.launches).toEqual([]);
  });
});
