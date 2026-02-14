import { sleep } from "./sleep.js";

export const createLeaseManager = ({
  commitLease,
  config,
}: {
  commitLease: (leaseMs: number) => Promise<void>;
  config: {
    leaseMs: number;
    renewIntervalMs: number;
  };
}): (() => Promise<void>) => {
  const abortController = new AbortController();

  const loopPromise = (async () => {
    while (true) {
      await sleep(config.renewIntervalMs, {
        signal: abortController.signal,
      });
      if (abortController.signal.aborted) {
        break;
      }
      try {
        await commitLease(config.leaseMs);
      } catch {
        break;
      }
    }
  })();

  return async () => {
    abortController.abort();
    await loopPromise;
  };
};
