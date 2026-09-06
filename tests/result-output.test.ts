import { EventEmitter } from "node:events";
import { Writable } from "node:stream";

import { describe, expect, test, vi } from "vitest";

import { createStreamOutputWrite } from "../src/result-output.js";

type WriteCallback = (error?: Error | null) => void;

const asWritable = (
  write: (bytes: string, callback: WriteCallback) => boolean
): NodeJS.WritableStream => {
  const stream = new EventEmitter() as EventEmitter & {
    write(bytes: string, callback: WriteCallback): boolean;
  };
  stream.write = write;
  return stream as unknown as NodeJS.WritableStream;
};

describe("createStreamOutputWrite", () => {
  test("resolves when the one stream write completes synchronously", async () => {
    const bytes = '{ "outcome": "SAFE_STOP" }\n';
    const write = vi.fn((_chunk: string, callback: WriteCallback) => {
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
    const stream = asWritable(write);

    await expect(
      createStreamOutputWrite(stream)('{"outcome":"BOOKED"}\n')
    ).rejects.toBe(failure);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(write).toHaveBeenCalledTimes(1);
    expect(stream.listenerCount("error")).toBe(0);
  });

  test("rejects an emitted write error once and removes its temporary listener", async () => {
    const failure = new Error("synthetic stdout emitted failure");
    const stream = new EventEmitter() as EventEmitter & {
      write(bytes: string, callback: WriteCallback): boolean;
    };
    let callback: WriteCallback | undefined;
    stream.write = vi.fn((_bytes: string, completed: WriteCallback) => {
      callback = completed;
      return true;
    });
    const rejected = vi.fn();

    const emission = createStreamOutputWrite(
      stream as unknown as NodeJS.WritableStream
    )('{"outcome":"BOOKED"}\n').catch((error: unknown) => {
      rejected(error);
      throw error;
    });

    expect(stream.listenerCount("error")).toBe(1);
    stream.emit("error", failure);
    callback?.(new Error("later callback failure"));

    await expect(emission).rejects.toBe(failure);
    expect(rejected).toHaveBeenCalledTimes(1);
    expect(stream.listenerCount("error")).toBe(0);
  });

  test("keeps its error listener through a writable callback error event", async () => {
    const failure = new Error("synthetic writable failure");
    const stream = new Writable({
      write(_chunk, _encoding, callback) {
        setImmediate(() => callback(failure));
      }
    });
    let listenerCountDuringError = 0;
    const observeError = (): void => {
      listenerCountDuringError = stream.listenerCount("error");
    };
    stream.prependListener("error", observeError);

    await expect(
      createStreamOutputWrite(stream)('{"outcome":"BOOKED"}\n')
    ).rejects.toBe(failure);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(listenerCountDuringError).toBe(2);
    expect(stream.listenerCount("error")).toBe(1);
    stream.removeListener("error", observeError);
  });

  test("removes its temporary error listener after a successful callback", async () => {
    const stream = new EventEmitter() as EventEmitter & {
      write(bytes: string, callback: WriteCallback): boolean;
    };
    let callback: WriteCallback | undefined;
    stream.write = vi.fn((_bytes: string, completed: WriteCallback) => {
      callback = completed;
      return true;
    });

    const emission = createStreamOutputWrite(
      stream as unknown as NodeJS.WritableStream
    )('{"outcome":"BOOKED"}\n');

    expect(stream.listenerCount("error")).toBe(1);
    callback?.();

    await expect(emission).resolves.toBe(undefined);
    expect(stream.listenerCount("error")).toBe(0);
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
