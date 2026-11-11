import type { NotifyAdapter } from "../../notify-adapter/notify-adapter.ts";
import { createFlakyBatchGenerator } from "./flaky-batch-generator.ts";

export type FlakyCallCounts = { calls: number; errors: number };

export const createFlakyNotifyAdapter = (
  notifyAdapter: NotifyAdapter,
): { notifyAdapter: NotifyAdapter; counts: FlakyCallCounts } => {
  const counts: FlakyCallCounts = { calls: 0, errors: 0 };
  const shouldError = createFlakyBatchGenerator();

  const maybeThrow = (): void => {
    counts.calls++;
    if (shouldError()) {
      counts.errors++;
      const error = new Error("connection reset") as Error & { code: string };
      error.code = "ECONNRESET";
      throw error;
    }
  };

  return {
    counts,
    notifyAdapter: {
      notifyJobsScheduled: async (typeNames) => {
        maybeThrow();
        await notifyAdapter.notifyJobsScheduled(typeNames);
      },
      listenJobScheduled: async (typeNames, onNotification) => {
        maybeThrow();
        return notifyAdapter.listenJobScheduled(typeNames, onNotification);
      },
      notifyChainsCompleted: async (chainIds) => {
        maybeThrow();
        await notifyAdapter.notifyChainsCompleted(chainIds);
      },
      listenChainCompleted: async (chainId, onNotification) => {
        maybeThrow();
        return notifyAdapter.listenChainCompleted(chainId, onNotification);
      },
      notifyJobAttemptsLost: async (jobIds) => {
        maybeThrow();
        await notifyAdapter.notifyJobAttemptsLost(jobIds);
      },
      listenJobAttemptLost: async (jobId, onNotification) => {
        maybeThrow();
        return notifyAdapter.listenJobAttemptLost(jobId, onNotification);
      },
      close: notifyAdapter.close,
      [Symbol.asyncDispose]: notifyAdapter.close,
    },
  };
};
