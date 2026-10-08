import { sleep } from "../helpers/sleep.js";

/** Configuration for job attempt timeout and heartbeat frequency. */
export type AttemptConfig = {
  /**
   * How long a worker holds an attempt before it can be reclaimed, unless the heartbeat
   * extends it. The lease starts when the job is acquired. Defaults to `60_000`.
   */
  timeoutMs: number;
  /** How often to extend the attempt's lease while the handler runs. Defaults to `30_000`. */
  heartbeatMs: number;
};

export type AttemptHeartbeat = {
  start: () => void;
  stop: () => Promise<void>;
};

/**
 * Renews an attempt's lease every `heartbeatMs` until stopped, or until `commitRenewal`
 * reports there is nothing left to renew by returning `false`.
 */
export const createAttemptHeartbeat = ({
  commitRenewal,
  config,
}: {
  commitRenewal: (timeoutMs: number) => Promise<boolean>;
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
      if (!(await commitRenewal(config.timeoutMs))) {
        break;
      }
    }
  };

  return {
    start: () => {
      loopPromise = runRenewalLoop();
      loopPromise.catch(() => {});
    },
    stop: async () => {
      abortController.abort();
      await loopPromise?.catch(() => {});
    },
  };
};
