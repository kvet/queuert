const MAX_TIMEOUT_MS = 2_147_483_647;

export const setLongTimeout = (callback: () => void, ms: number): (() => void) => {
  // Match setTimeout, which fires NaN delays right away; Infinity re-arms forever.
  const delayMs = Number.isNaN(ms) ? 0 : ms;
  const deadline = Date.now() + delayMs;
  let timeoutId: ReturnType<typeof setTimeout>;
  const arm = (remainingMs: number): void => {
    if (remainingMs <= MAX_TIMEOUT_MS) {
      timeoutId = setTimeout(callback, remainingMs);
      return;
    }
    timeoutId = setTimeout(() => {
      arm(deadline - Date.now());
    }, MAX_TIMEOUT_MS);
  };
  arm(delayMs);
  return () => {
    clearTimeout(timeoutId);
  };
};

export const sleep = async (
  ms: number,
  { jitterMs = 0, signal }: { jitterMs?: number; signal?: AbortSignal } = {},
): Promise<void> =>
  new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }

    const onAbort = () => {
      clearLongTimeout();
      resolve();
    };

    const clearLongTimeout = setLongTimeout(
      () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      },
      Math.max(0, ms + (jitterMs ? Math.floor(Math.random() * jitterMs) - jitterMs / 2 : 0)),
    );

    signal?.addEventListener("abort", onAbort, { once: true });
  });

/**
 * Races a promise against a sleep timer, automatically cleaning up the timer
 * when the promise wins. This prevents orphaned timers from keeping the process alive.
 *
 * @param promise - The promise to race against the sleep
 * @param ms - Sleep duration in milliseconds
 * @param options - Optional jitter and abort signal
 * @returns void when either the promise resolves or the sleep completes
 */
export const raceWithSleep = async (
  promise: Promise<void>,
  ms: number,
  options?: { jitterMs?: number; signal?: AbortSignal },
): Promise<void> => {
  const cleanupController = new AbortController();
  const sleepSignal = options?.signal
    ? AbortSignal.any([options.signal, cleanupController.signal])
    : cleanupController.signal;

  try {
    await Promise.race([promise, sleep(ms, { jitterMs: options?.jitterMs, signal: sleepSignal })]);
  } finally {
    cleanupController.abort();
  }
};
