import type { NotifyAdapter } from "./notify-adapter.js";

type JobScheduledNotification = { typeName: string; hintId: string };

export const createInProcessNotifyAdapter = (): NotifyAdapter => {
  const hintCounts = new Map<string, number>();

  const jobScheduledListeners: Array<(notification: JobScheduledNotification) => void> = [];
  const sequenceCompletedListeners: Array<(sequenceId: string) => void> = [];
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

      setTimeout(() => hintCounts.delete(hintId), 60_000);

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

    notifyJobSequenceCompleted: async (sequenceId: string) => {
      for (const listener of sequenceCompletedListeners.slice()) {
        listener(sequenceId);
      }
    },

    listenJobSequenceCompleted: async (targetSequenceId, onNotification) => {
      const listener = (sequenceId: string): void => {
        if (sequenceId === targetSequenceId) {
          onNotification();
        }
      };

      sequenceCompletedListeners.push(listener);

      return async () => {
        const index = sequenceCompletedListeners.indexOf(listener);
        if (index !== -1) {
          sequenceCompletedListeners.splice(index, 1);
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
