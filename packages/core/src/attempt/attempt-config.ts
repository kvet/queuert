import { isPositiveFinite } from "@queuert/helpers";

/** Configuration for job attempt timeout and heartbeat frequency. */
export type AttemptConfig = {
  /**
   * How long a worker holds an attempt before it can be reclaimed, unless the heartbeat
   * extends it. The timeout starts when the job is acquired. Must be finite and positive.
   * Defaults to `60_000`.
   */
  timeoutMs: number;
  /**
   * How often to extend the attempt while the handler runs. Must be finite and
   * positive. Defaults to `30_000`.
   */
  heartbeatMs: number;
};

export const attemptConfigViolations = (
  name: string,
  config: AttemptConfig | undefined,
): string[] => {
  if (config === undefined) return [];
  const violations: string[] = [];
  if (!isPositiveFinite(config.timeoutMs)) {
    violations.push(
      `${name}.timeoutMs must be a positive finite number (got ${String(config.timeoutMs)})`,
    );
  }
  if (!isPositiveFinite(config.heartbeatMs)) {
    violations.push(
      `${name}.heartbeatMs must be a positive finite number (got ${String(config.heartbeatMs)})`,
    );
  }
  return violations;
};
