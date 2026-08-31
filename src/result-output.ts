export type ResultEmitter = (bytes: string) => Promise<void>;

export function createStreamOutputWrite(
  stream: NodeJS.WritableStream
): ResultEmitter {
  return (bytes) =>
    new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanup = (): void => {
        stream.removeListener("error", onError);
      };
      const settle = (error?: Error | null): void => {
        if (settled) return;
        settled = true;
        if (error == null) resolve();
        else reject(error);
      };
      const onError = (error: Error): void => {
        cleanup();
        settle(error);
      };
      const complete = (error?: Error | null): void => {
        if (error == null) {
          cleanup();
          settle();
          return;
        }
        settle(error);
        setImmediate(cleanup);
      };

      try {
        stream.once("error", onError);
        stream.write(bytes, complete);
      } catch (error) {
        cleanup();
        settle(error instanceof Error ? error : new Error("output failed"));
      }
    });
}

export const writeResultToStdout: ResultEmitter = createStreamOutputWrite(
  process.stdout
);
