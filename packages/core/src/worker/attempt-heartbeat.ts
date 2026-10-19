import { isPositiveFinite } from "../helpers/number.js";
import { sleep } from "../helpers/sleep.js";

/** Configuration for job attempt timeout and heartbeat frequency. */
export type AttemptConfig = {
  /**
   * How long a worker holds a staged attempt before it can be reclaimed, counted from acquire
   * and renewed by the heartbeat. An atomic attempt's lease stays uncommitted inside its one
   * transaction, so it is never reclaimed. Must be finite and positive. Defaults to `60_000`.
   */
  timeoutMs: number;
  /**
   * How often to extend the attempt deadline of a staged attempt. Must be finite and positive.
   * Defaults to `30_000`.
   */
  heartbeatMs: number;
};

export type AttemptHeartbeat = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
};

export const createAttemptHeartbeat = ({
  commitRenewal,
  config,
}: {
  commitRenewal: (timeoutMs: number) => Promise<void>;
  config: AttemptConfig;
}): AttemptHeartbeat => {
  const abortController = new AbortController();
  let loopPromise: Promise<void> | undefined;

  const runRenewalLoop = async () => {
    while (!abortController.signal.aborted) {
      await sleep(config.heartbeatMs, {
        signal: abortController.signal,
      });
      if (abortController.signal.aborted) {
        break;
      }
      await commitRenewal(config.timeoutMs);
    }
  };

  return {
    start: async () => {
      loopPromise = runRenewalLoop();
      loopPromise.catch(() => {});
    },
    stop: async () => {
      abortController.abort();
      await loopPromise?.catch(() => {});
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
