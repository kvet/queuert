import type { NotifyAdapter } from "./notify-adapter.js";

type JobScheduledNotification = { typeName: string; hintId: string };

export const createInProcessNotifyAdapter = (): NotifyAdapter => {
  const hintCounts = new Map<string, number>();

  const jobScheduledListeners: Array<(notification: JobScheduledNotification) => void> = [];
  const chainCompletedListeners: Array<(chainId: string) => void> = [];
  const jobOwnershipLostListeners: Array<(jobId: string) => void> = [];

  const tryConsumeHint = (hintId: string): boolean => {
    const count = hintCounts.get(hintId) ?? 0;
    if (count > 0) {
      hintCounts.set(hintId, count - 1);
      return true;
    }
    return false;
  };

  return {
    notifyJobScheduled: async (typeName: string, count: number) => {
      const hintId = crypto.randomUUID();
      hintCounts.set(hintId, count);

      setTimeout(() => hintCounts.delete(hintId), 60_000).unref();

      for (const listener of jobScheduledListeners.slice()) {
        listener({ typeName, hintId });
      }
    },

    listenJobScheduled: async (typeNames, onNotification) => {
      const listener = ({ typeName, hintId }: JobScheduledNotification): void => {
        if (typeNames.includes(typeName) && tryConsumeHint(hintId)) {
          onNotification(typeName);
        }
      };

      jobScheduledListeners.push(listener);

      return async () => {
        const index = jobScheduledListeners.indexOf(listener);
        if (index !== -1) {
          jobScheduledListeners.splice(index, 1);
        }
      };
    },

    notifyJobChainCompleted: async (chainId: string) => {
      for (const listener of chainCompletedListeners.slice()) {
        listener(chainId);
      }
    },

    listenJobChainCompleted: async (targetChainId, onNotification) => {
      const listener = (chainId: string): void => {
        if (chainId === targetChainId) {
          onNotification();
        }
      };

      chainCompletedListeners.push(listener);

      return async () => {
        const index = chainCompletedListeners.indexOf(listener);
        if (index !== -1) {
          chainCompletedListeners.splice(index, 1);
        }
      };
    },

    notifyJobOwnershipLost: async (jobId: string) => {
      for (const listener of jobOwnershipLostListeners.slice()) {
        listener(jobId);
      }
    },

    listenJobOwnershipLost: async (targetJobId, onNotification) => {
      const listener = (jobId: string): void => {
        if (jobId === targetJobId) {
          onNotification();
        }
      };

      jobOwnershipLostListeners.push(listener);

      return async () => {
        const index = jobOwnershipLostListeners.indexOf(listener);
        if (index !== -1) {
          jobOwnershipLostListeners.splice(index, 1);
        }
      };
    },
  };
};
