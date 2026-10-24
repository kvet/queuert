import { sleep, isPositiveFinite } from "@queuert/helpers";

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

/**
 * Extends an attempt every `heartbeatMs` from creation until stopped, or until `extend`
 * reports there is nothing left to extend by returning `false`.
 */
export const createAttemptHeartbeat = ({
  extend,
  config,
}: {
  extend: (timeoutMs: number) => Promise<boolean>;
  config: AttemptConfig;
}): { stop: () => Promise<void> } => {
  const abortController = new AbortController();

  const runExtensionLoop = async () => {
    while (!abortController.signal.aborted) {
      await sleep(config.heartbeatMs, {
        signal: abortController.signal,
      });
      if (abortController.signal.aborted) {
        break;
      }
      if (!(await extend(config.timeoutMs))) {
        break;
      }
    }
  };
  const loopPromise = runExtensionLoop().catch(() => {});

  return {
    stop: async () => {
      abortController.abort();
      await loopPromise;
    },
  };
};

/** Lists every invalid field of an attempt config, each prefixed with `name`. */
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
