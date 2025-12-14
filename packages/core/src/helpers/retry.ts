import { BackoffConfig, calculateBackoffMs } from "./backoff.js";
import { sleep } from "./sleep.js";

export type RetryConfig = BackoffConfig & { maxAttempts?: number };

export const withRetry = async <T>(
  fn: () => Promise<T>,
  { maxAttempts = Infinity, ...config }: RetryConfig,
  {
    signal,
    isRetryableError = () => true,
  }: { signal?: AbortSignal; isRetryableError?: (error: unknown) => boolean } = {},
): Promise<T> => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (!isRetryableError(error)) {
        throw error;
      }

      if (attempt < maxAttempts) {
        const delayMs = calculateBackoffMs(attempt, config);
        await sleep(delayMs, { signal });
        if (signal?.aborted) {
          throw lastError;
        }
      }
    }
  }

  throw lastError;
};
