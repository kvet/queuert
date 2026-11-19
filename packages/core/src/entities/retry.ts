import { isPositiveFinite } from "@queuert/helpers/number";
import { sleep } from "@queuert/helpers/sleep";

import { type BackoffConfig, backoffConfigViolations, calculateBackoffMs } from "./backoff.ts";

/**
 * Retries of a transaction or statement that failed on a conflict with a concurrent one. Each
 * retry waits a random delay up to the {@link BackoffConfig} delay of the failed try.
 */
export type RetryConfig = BackoffConfig & {
  /** Most tries, the first included. Must be a positive integer. */
  maxTries: number;
};

export const withRetry = async <T>(
  fn: (tryNumber: number) => Promise<T>,
  config: RetryConfig,
  isRetryableError: (error: unknown) => boolean,
): Promise<T> => {
  for (let tryNumber = 1; ; tryNumber++) {
    try {
      return await fn(tryNumber);
    } catch (error) {
      if (tryNumber >= config.maxTries || !isRetryableError(error)) throw error;
      await sleep(Math.random() * calculateBackoffMs(tryNumber, config));
    }
  }
};

export const retryConfigViolations = (name: string, config: RetryConfig): string[] => [
  ...(Number.isSafeInteger(config.maxTries) && isPositiveFinite(config.maxTries)
    ? []
    : [`${name}.maxTries must be a positive integer (got ${String(config.maxTries)})`]),
  ...backoffConfigViolations(name, config),
];
