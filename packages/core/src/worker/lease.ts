import { sleep } from "../helpers/sleep.js";

export type LeaseConfig = {
  /** How long a worker holds a job before it can be reclaimed */
  leaseMs: number;
  /** How often to renew the lease */
  renewIntervalMs: number;
};

export type LeaseManager = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
};

export const createLeaseManager = ({
  commitLease,
  config,
}: {
  commitLease: (leaseMs: number) => Promise<void>;
  config: LeaseConfig;
}): LeaseManager => {
  const abortController = new AbortController();
  let loopPromise: Promise<void> | undefined;

  const runRenewalLoop = async () => {
    while (!abortController.signal.aborted) {
      await sleep(config.renewIntervalMs, {
        signal: abortController.signal,
      });
      if (abortController.signal.aborted) {
        break;
      }
      await commitLease(config.leaseMs);
    }
  };

  return {
    start: async () => {
      loopPromise = runRenewalLoop();
    },
    stop: async () => {
      abortController.abort();
      await loopPromise?.catch(() => {});
    },
  };
};
