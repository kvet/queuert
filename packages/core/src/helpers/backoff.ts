export type BackoffConfig = {
  initialDelayMs: number;
  maxDelayMs: number;
  multiplier?: number;
};

export const calculateBackoffMs = (attempt: number, config: BackoffConfig): number => {
  const multiplier = config.multiplier ?? 2;
  const backoffMs = config.initialDelayMs * Math.pow(multiplier, attempt - 1);
  return Math.min(backoffMs, config.maxDelayMs);
};
