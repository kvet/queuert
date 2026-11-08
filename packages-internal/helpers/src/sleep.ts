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
 * @returns the promise's value when it resolves first, `undefined` when the sleep completes first
 */
// oxlint-disable-next-line typescript/promise-function-async -- an async wrapper would add a promise and ticks per wait
export const raceWithSleep = <T>(
  promise: Promise<T>,
  ms: number,
  { jitterMs = 0, signal }: { jitterMs?: number; signal?: AbortSignal } = {},
): Promise<T | undefined> =>
  new Promise<T | undefined>((resolve, reject) => {
    let clearLongTimeout = (): void => {};
    const settle = (): void => {
      clearLongTimeout();
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = (): void => {
      settle();
      resolve(undefined);
    };

    promise.then(
      (value) => {
        settle();
        resolve(value);
      },
      (error: unknown) => {
        settle();
        // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- forwarding the raced promise's rejection
        reject(error);
      },
    );

    if (signal?.aborted) {
      queueMicrotask(onAbort);
      return;
    }
    clearLongTimeout = setLongTimeout(
      onAbort,
      Math.max(0, ms + (jitterMs ? Math.floor(Math.random() * jitterMs) - jitterMs / 2 : 0)),
    );
    signal?.addEventListener("abort", onAbort, { once: true });
  });
