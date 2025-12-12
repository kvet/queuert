export const sleep = (
  ms: number,
  { jitterMs = 0, signal }: { jitterMs?: number; signal?: AbortSignal } = {},
): Promise<void> =>
  new Promise((resolve) => {
    if (signal?.aborted) return resolve();

    const onAbort = () => {
      clearTimeout(timeoutId);
      resolve();
    };

    const timeoutId = setTimeout(
      () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      },
      Math.max(0, ms + (jitterMs ? Math.floor(Math.random() * jitterMs) - jitterMs / 2 : 0)),
    );

    signal?.addEventListener("abort", onAbort, { once: true });
  });
