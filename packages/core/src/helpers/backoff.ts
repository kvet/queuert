export type BackoffConfig = {
  /** Initial delay in milliseconds before first retry */
  initialDelayMs: number;
  /** Maximum delay in milliseconds between retries */
  maxDelayMs: number;
  /** Exponential backoff multiplier */
  multiplier?: number;
};

export const calculateBackoffMs = (attempt: number, config: BackoffConfig): number => {
  const multiplier = config.multiplier ?? 2;
  const backoffMs = config.initialDelayMs * Math.pow(multiplier, attempt - 1);
  return Math.min(backoffMs, config.maxDelayMs);
};
