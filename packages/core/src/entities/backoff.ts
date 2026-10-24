import { isNonNegative, isNonNegativeFinite, isPositiveFinite } from "@queuert/helpers";

/** Exponential backoff configuration for retry delays. */
export type BackoffConfig = {
  /** Initial delay in milliseconds before first retry. Must be finite and non-negative. */
  initialDelayMs: number;
  /** Maximum delay in milliseconds between retries. Must be non-negative; `Infinity` means no cap. */
  maxDelayMs: number;
  /** Exponential backoff multiplier. Must be finite and positive. @default 2 */
  multiplier?: number;
};

export const calculateBackoffMs = (attempt: number, config: BackoffConfig): number => {
  const multiplier = config.multiplier ?? 2;
  const backoffMs = config.initialDelayMs * Math.pow(multiplier, attempt - 1);
  return Math.min(backoffMs, config.maxDelayMs);
};

/** Lists every invalid field of a backoff config, each prefixed with `name`. */
export const backoffConfigViolations = (
  name: string,
  config: BackoffConfig | undefined,
): string[] => {
  if (config === undefined) return [];
  const violations: string[] = [];
  if (!isNonNegativeFinite(config.initialDelayMs)) {
    violations.push(
      `${name}.initialDelayMs must be a non-negative finite number (got ${String(config.initialDelayMs)})`,
    );
  }
  if (!isNonNegative(config.maxDelayMs)) {
    violations.push(
      `${name}.maxDelayMs must be a non-negative number (got ${String(config.maxDelayMs)})`,
    );
  }
  if (config.multiplier !== undefined && !isPositiveFinite(config.multiplier)) {
    violations.push(
      `${name}.multiplier must be a positive finite number (got ${String(config.multiplier)})`,
    );
  }
  return violations;
};
