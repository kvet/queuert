import type { NotifyAdapter } from "./notify-adapter.ts";
import { batchNotify } from "./notify-helper.async-only.ts";

// unasync: rename SyncNotifyHelper
export type NotifyHelper = {
  notifyJobsScheduled: (typeNames: string[]) => Promise<void>;
  notifyChainsCompleted: (chainIds: string[]) => Promise<void>;
  notifyJobAttemptsLost: (jobIds: string[]) => Promise<void>;
  listenJobScheduled: (
    typeNames: string[],
    onNotification: (typeName: string) => void,
  ) => Promise<() => Promise<void>>;
  listenChainCompleted: (
    chainId: string,
    onNotification: () => void,
  ) => Promise<() => Promise<void>>;
  listenJobAttemptLost: (jobId: string, onNotification: () => void) => Promise<() => Promise<void>>;
};

// unasync: rename createSyncNotifyHelper
export const createNotifyHelper = ({ adapter }: { adapter: NotifyAdapter }): NotifyHelper => {
  const listen = async (
    subscribe: () => Promise<() => Promise<void>>,
  ): Promise<() => Promise<void>> => {
    try {
      const dispose = await subscribe();
      return async () => {
        try {
          await dispose();
        } catch {}
      };
    } catch {
      return async () => {};
    }
  };

  return {
    notifyJobsScheduled: batchNotify(async (typeNames) => {
      await adapter.notifyJobsScheduled(typeNames);
    }),
    notifyChainsCompleted: batchNotify(async (chainIds) => {
      await adapter.notifyChainsCompleted(chainIds);
    }),
    notifyJobAttemptsLost: batchNotify(async (jobIds) => {
      await adapter.notifyJobAttemptsLost(jobIds);
    }),
    listenJobScheduled: async (typeNames, onNotification) =>
      listen(async () => adapter.listenJobScheduled(typeNames, onNotification)),
    listenChainCompleted: async (chainId, onNotification) =>
      listen(async () => adapter.listenChainCompleted(chainId, onNotification)),
    listenJobAttemptLost: async (jobId, onNotification) =>
      listen(async () => adapter.listenJobAttemptLost(jobId, onNotification)),
  };
};
