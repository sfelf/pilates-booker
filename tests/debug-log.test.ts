import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createDebugLogger,
  NOOP_DEBUG_LOGGER,
  type DebugEvent
} from "../src/debug-log.js";
import { resolveRuntimePaths } from "../src/runtime-paths.js";

const fixedMetadata = {
  now: () => new Date("2030-01-16T18:30:00.000Z"),
  pid: 4242,
  version: "0.2.0"
};

const event: DebugEvent = {
  event: "command.started",
  stage: "STARTING",
  submission_started: false,
  response_emitted: false,
  data: {
    arguments: {
      booking_url:
        "https://app.arketa.co/iframe/synthetic/calendar/checkout/CLASS_ID",
      allowed_packages: ["⭐ 10-Class Pack", "José’s Reformer"],
      permitted_actions: ["book", "waitlist"],
      dry_run: true,
      runtime: "/private/Pilates Booker",
      debug: true
    }
  }
};

describe("debug logger", () => {
  it("performs no filesystem access when disabled", async () => {
    const base = await mkdtemp(join(tmpdir(), "pilates-no-debug-"));
    await NOOP_DEBUG_LOGGER.append(event);
    await expect(
      readFile(join(base, "pilates-booker.log"))
    ).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("appends compact ordered NDJSON with validated reconstructed arguments", async () => {
    const base = await mkdtemp(join(tmpdir(), "pilates-debug-"));
    const paths = resolveRuntimePaths(base);
    const logger = await createDebugLogger(paths, fixedMetadata);
    await logger.append(event);
    await logger.append({
      ...event,
      event: "workflow.observed",
      stage: "VALIDATED"
    });

    const raw = await readFile(paths.logFile, "utf8");
    const lines = raw.trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(
      lines.every((line) => JSON.stringify(JSON.parse(line)) === line)
    ).toBe(true);
    expect(JSON.parse(lines[0]!)).toEqual({
      timestamp: "2030-01-16T18:30:00.000Z",
      pid: 4242,
      version: "0.2.0",
      ...event
    });
    expect(JSON.parse(lines[1]!)).toMatchObject({
      event: "workflow.observed",
      stage: "VALIDATED"
    });
    if (process.platform !== "win32") {
      expect((await stat(paths.logFile)).mode & 0o777).toBe(0o600);
    }
  });

  it("rotates before crossing 1 MiB and retains exactly one previous file", async () => {
    const base = await mkdtemp(join(tmpdir(), "pilates-rotate-"));
    const paths = resolveRuntimePaths(base);
    const prior = "x".repeat(1024 * 1024 - 10);
    await writeFile(paths.logFile, prior, { mode: 0o600 });
    await writeFile(paths.rotatedLogFile, "older", { mode: 0o600 });
    await chmod(paths.logFile, 0o600);
    const logger = await createDebugLogger(paths, fixedMetadata);
    await logger.append(event);

    expect(await readFile(paths.rotatedLogFile, "utf8")).toBe(prior);
    expect(
      JSON.parse((await readFile(paths.logFile, "utf8")).trim())
    ).toMatchObject({
      event: "command.started"
    });
    await expect(readFile(`${paths.logFile}.2`)).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("projects only allowlisted data and excludes private or authentication fields", async () => {
    const base = await mkdtemp(join(tmpdir(), "pilates-fields-"));
    const paths = resolveRuntimePaths(base);
    const logger = await createDebugLogger(paths, fixedMetadata);
    await logger.append({
      ...event,
      data: {
        observed_class: {
          name: "José’s Reformer",
          instructor: "Synthetic Instructor",
          date: "2030-01-16",
          start_time: "10:30",
          end_time: "11:20",
          timezone: "PST"
        },
        status_code: 503,
        exception: {
          name: "Error",
          message: "Authorization: Bearer private-token",
          stack: "Error: failed\\nat /private/path"
        },
        headers: { authorization: "Bearer private-token" },
        cookies: "private-cookie",
        token: "private-token",
        storage: { secret: true },
        attendee: "Private Person",
        injury: "Private answer",
        html: "<body>private page</body>"
      } as never
    });

    const raw = await readFile(paths.logFile, "utf8");
    expect(raw).toContain("José’s Reformer");
    expect(raw).toContain('"status_code":503');
    expect(raw).not.toMatch(
      /private-token|private-cookie|Private Person|Private answer|private page/u
    );
    expect(raw).not.toMatch(/headers|cookies|storage|attendee|injury|html/u);
  });

  it("serializes concurrent appends in invocation order", async () => {
    const base = await mkdtemp(join(tmpdir(), "pilates-ordered-"));
    const paths = resolveRuntimePaths(base);
    const logger = await createDebugLogger(paths, fixedMetadata);
    await Promise.all([
      logger.append({ ...event, event: "first" }),
      logger.append({ ...event, event: "second" }),
      logger.append({ ...event, event: "third" })
    ]);
    const records = (await readFile(paths.logFile, "utf8"))
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line) as { event: string });
    expect(records.map((record) => record.event)).toEqual([
      "first",
      "second",
      "third"
    ]);
  });

  it("rejects a single record larger than the bounded log before modifying files", async () => {
    const base = await mkdtemp(join(tmpdir(), "pilates-oversized-"));
    const paths = resolveRuntimePaths(base);
    const logger = await createDebugLogger(paths, fixedMetadata);
    await expect(
      logger.append({
        ...event,
        data: {
          arguments: {
            ...event.data!.arguments!,
            allowed_packages: Array.from(
              { length: 300 },
              (_, index) => `${index}-${"x".repeat(4090)}`
            )
          }
        }
      })
    ).rejects.toThrow("Debug log record exceeds 1 MiB");

    expect(await readFile(paths.logFile, "utf8")).toBe("");
    await expect(readFile(paths.rotatedLogFile)).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("propagates initialization, rotation, and append failures", async () => {
    const root = await mkdtemp(join(tmpdir(), "pilates-failures-"));
    const blockedBase = join(root, "not-a-directory");
    await writeFile(blockedBase, "file");
    await expect(
      createDebugLogger(resolveRuntimePaths(blockedBase), fixedMetadata)
    ).rejects.toBeDefined();

    const rotationBase = join(root, "rotation");
    const rotationPaths = resolveRuntimePaths(rotationBase);
    await mkdir(rotationBase);
    await writeFile(rotationPaths.logFile, "x".repeat(1024 * 1024 - 10));
    await mkdir(rotationPaths.rotatedLogFile);
    const rotationLogger = await createDebugLogger(
      rotationPaths,
      fixedMetadata
    );
    await expect(rotationLogger.append(event)).rejects.toBeDefined();

    const appendBase = join(root, "append");
    const appendPaths = resolveRuntimePaths(appendBase);
    const appendLogger = await createDebugLogger(appendPaths, fixedMetadata);
    await rename(appendPaths.logFile, `${appendPaths.logFile}.moved`);
    await mkdir(appendPaths.logFile);
    await expect(appendLogger.append(event)).rejects.toBeDefined();
  });
});
