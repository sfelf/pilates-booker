export type ResultEmitter = (bytes: string) => Promise<void>;

export function createStreamOutputWrite(
  stream: NodeJS.WritableStream
): ResultEmitter {
  return (bytes) =>
    new Promise<void>((resolve, reject) => {
      let settled = false;
      const complete = (error?: Error | null): void => {
        if (settled) return;
        settled = true;
        if (error == null) resolve();
        else reject(error);
      };

      try {
        stream.write(bytes, complete);
      } catch (error) {
        complete(error instanceof Error ? error : new Error("output failed"));
      }
    });
}

export const writeResultToStdout: ResultEmitter = createStreamOutputWrite(
  process.stdout
);
