import { sleep } from "./sleep.js";

export type RetryConfig = {
  initialIntervalMs?: number;
  backoffCoefficient?: number;
  maxIntervalMs?: number;
};

const DEFAULT_RETRY_CONFIG = {
  initialIntervalMs: 1000,
  backoffCoefficient: 2.0,
  maxIntervalMs: 100 * 1000,
} satisfies RetryConfig;

export const calculateBackoffMs = (attempt: number, config: RetryConfig): number => {
  const initialIntervalMs = config.initialIntervalMs ?? DEFAULT_RETRY_CONFIG.initialIntervalMs;
  const backoffCoefficient = config.backoffCoefficient ?? DEFAULT_RETRY_CONFIG.backoffCoefficient;
  const maxIntervalMs = config.maxIntervalMs ?? DEFAULT_RETRY_CONFIG.maxIntervalMs;

  const backoffMs = initialIntervalMs * Math.pow(backoffCoefficient, attempt - 1);
  return Math.min(backoffMs, maxIntervalMs);
};

export type BoundedRetryConfig = RetryConfig & { maxRetries?: number };

export const withRetry = async <T>(
  fn: () => Promise<T>,
  config: BoundedRetryConfig,
  {
    signal,
    isRetryableError = () => true,
  }: { signal?: AbortSignal; isRetryableError?: (error: unknown) => boolean } = {},
): Promise<T> => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= (config.maxRetries ?? Infinity); attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (!isRetryableError(error)) {
        throw error;
      }

      if (attempt < (config.maxRetries ?? Infinity)) {
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
