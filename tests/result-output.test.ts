import { EventEmitter } from "node:events";

import { describe, expect, test, vi } from "vitest";

import { createStreamOutputWrite } from "../src/result-output.js";

type WriteCallback = (error?: Error | null) => void;

const asWritable = (
  write: (bytes: string, callback: WriteCallback) => boolean
): NodeJS.WritableStream => ({ write }) as unknown as NodeJS.WritableStream;

describe("createStreamOutputWrite", () => {
  test("resolves when the one stream write completes synchronously", async () => {
    const bytes = '{ "outcome": "SAFE_STOP" }\n';
    const write = vi.fn((chunk: string, callback: WriteCallback) => {
      callback();
      return true;
    });

    await expect(
      createStreamOutputWrite(asWritable(write))(bytes)
    ).resolves.toBe(undefined);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0]).toBe(bytes);
  });

  test("waits for the write callback after backpressure and drain", async () => {
    const stream = new EventEmitter() as EventEmitter & {
      write(bytes: string, callback: WriteCallback): boolean;
    };
    let callback: WriteCallback | undefined;
    stream.write = vi.fn((_bytes: string, completed: WriteCallback) => {
      callback = completed;
      return false;
    });
    const settled = vi.fn();

    const emission = createStreamOutputWrite(
      stream as unknown as NodeJS.WritableStream
    )('{"outcome":"BOOKED"}\n').then(settled);
    stream.emit("drain");
    await Promise.resolve();

    expect(settled).not.toHaveBeenCalled();
    callback?.();
    await emission;
    expect(settled).toHaveBeenCalledTimes(1);
    expect(stream.write).toHaveBeenCalledTimes(1);
  });

  test("rejects a callback error", async () => {
    const failure = new Error("synthetic stdout callback failure");
    const write = vi.fn((_bytes: string, callback: WriteCallback) => {
      callback(failure);
      return true;
    });

    await expect(
      createStreamOutputWrite(asWritable(write))('{"outcome":"BOOKED"}\n')
    ).rejects.toBe(failure);
    expect(write).toHaveBeenCalledTimes(1);
  });

  test("rejects when stream.write throws", async () => {
    const failure = new Error("synthetic stdout throw");
    const write = vi.fn(() => {
      throw failure;
    });

    await expect(
      createStreamOutputWrite(asWritable(write))('{"outcome":"BOOKED"}\n')
    ).rejects.toBe(failure);
    expect(write).toHaveBeenCalledTimes(1);
  });

  test("passes one unchanged byte string without serializing it", async () => {
    const bytes = ' { "details": "already serialized", "schema_version": 1 }\n';
    const chunks: unknown[] = [];
    const write = vi.fn((chunk: string, callback: WriteCallback) => {
      chunks.push(chunk);
      callback();
      return true;
    });

    await createStreamOutputWrite(asWritable(write))(bytes);

    expect(chunks).toEqual([bytes]);
    expect(chunks[0]).toBe(bytes);
  });
});
