export class TimeoutAbortError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = "TimeoutAbortError";
  }
}

export const sleep = (
  ms: number,
  { jitterMs = 0, signal }: { jitterMs?: number; signal?: AbortSignal } = {},
): Promise<void> =>
  new Promise((resolve, reject) => {
    let timeoutId: NodeJS.Timeout;
    const onAbort = () => {
      clearTimeout(timeoutId);
      reject(new TimeoutAbortError("Sleep aborted"));
    };
    if (signal) {
      if (signal.aborted) {
        return onAbort();
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
    timeoutId = setTimeout(
      () => {
        if (signal) {
          signal.removeEventListener("abort", onAbort);
        }
        resolve();
      },
      Math.max(0, ms + (jitterMs ? Math.floor(Math.random() * jitterMs) - jitterMs / 2 : 0)),
    );
  });
