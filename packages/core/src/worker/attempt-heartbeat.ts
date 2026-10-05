import { sleep } from "../helpers/sleep.js";

/** Configuration for job attempt timeout and heartbeat frequency. */
export type AttemptConfig = {
  /**
   * How long a worker holds a staged attempt before it can be reclaimed. Atomic attempts run in
   * one transaction and have no deadline. Defaults to `60_000`.
   */
  timeoutMs: number;
  /** How often to extend the attempt deadline of a staged attempt. Defaults to `30_000`. */
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
