import type { NotifyAdapter, SyncNotifyAdapter } from "queuert";

export const toAsyncNotifyAdapter = (notifyAdapter: SyncNotifyAdapter): NotifyAdapter => {
  const listened =
    (dispose: () => void): (() => Promise<void>) =>
    async () => {
      dispose();
    };
  return {
    notifyJobsScheduled: async (typeNames) => {
      notifyAdapter.notifyJobsScheduled(typeNames);
    },
    listenJobScheduled: async (typeNames, onNotification) =>
      listened(notifyAdapter.listenJobScheduled(typeNames, onNotification)),
    notifyChainsCompleted: async (chainIds) => {
      notifyAdapter.notifyChainsCompleted(chainIds);
    },
    listenChainCompleted: async (chainId, onNotification) =>
      listened(notifyAdapter.listenChainCompleted(chainId, onNotification)),
    notifyJobAttemptsLost: async (jobIds) => {
      notifyAdapter.notifyJobAttemptsLost(jobIds);
    },
    listenJobAttemptLost: async (jobId, onNotification) =>
      listened(notifyAdapter.listenJobAttemptLost(jobId, onNotification)),
    close: async () => {
      notifyAdapter.close();
    },
    [Symbol.asyncDispose]: async () => {
      notifyAdapter.close();
    },
  };
};
