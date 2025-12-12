import { sleep } from "../helpers/sleep.js";

export type LeaseConfig = {
  leaseMs?: number;
  renewIntervalMs?: number;
};

const DEFAULT_LEASE_CONFIG = {
  leaseMs: 30 * 1000,
  renewIntervalMs: 15 * 1000,
} satisfies LeaseConfig;

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
      await sleep(config.renewIntervalMs ?? DEFAULT_LEASE_CONFIG.renewIntervalMs, {
        signal: abortController.signal,
      });
      if (abortController.signal.aborted) {
        break;
      }
      await commitLease(config.leaseMs ?? DEFAULT_LEASE_CONFIG.leaseMs);
    }
  };

  return {
    start: async () => {
      await commitLease(config.leaseMs ?? DEFAULT_LEASE_CONFIG.leaseMs);
      loopPromise = runRenewalLoop();
    },
    stop: async () => {
      abortController.abort();
      await loopPromise?.catch(() => {});
    },
  };
};
