import { NotifyAdapter } from "./notify-adapter.js";

export const createInProcessNotifyAdapter = (): NotifyAdapter => {
  const jobScheduledListeners: Array<(typeName: string) => boolean> = [];
  const sequenceCompletedListeners: Array<(sequenceId: string) => boolean> = [];
  const jobOwnershipLostListeners: Array<(jobId: string) => boolean> = [];

  return {
    notifyJobScheduled: async (typeName: string) => {
      for (const listener of jobScheduledListeners.slice()) {
        listener(typeName);
      }
    },
    listenJobScheduled: async (typeNames: string[], { signal }: { signal?: AbortSignal }) => {
      return new Promise<void>((resolve) => {
        if (signal?.aborted) {
          resolve();
          return;
        }

        const cleanup = () => {
          const index = jobScheduledListeners.indexOf(listener);
          if (index !== -1) {
            jobScheduledListeners.splice(index, 1);
          }
        };

        const listener = (notifiedTypeName: string) => {
          if (typeNames.includes(notifiedTypeName)) {
            cleanup();
            signal?.removeEventListener("abort", onAbort);
            resolve();
            return true;
          }
          return false;
        };

        const onAbort = () => {
          cleanup();
          resolve();
        };

        jobScheduledListeners.push(listener);
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    },
    notifyJobSequenceCompleted: async (sequenceId: string) => {
      for (const listener of sequenceCompletedListeners.slice()) {
        listener(sequenceId);
      }
    },
    listenJobSequenceCompleted: async (
      sequenceIds: string[],
      { signal }: { signal?: AbortSignal },
    ) => {
      return new Promise<string | undefined>((resolve) => {
        if (signal?.aborted) {
          resolve(undefined);
          return;
        }

        const cleanup = () => {
          const index = sequenceCompletedListeners.indexOf(listener);
          if (index !== -1) {
            sequenceCompletedListeners.splice(index, 1);
          }
        };

        const listener = (completedSequenceId: string) => {
          if (sequenceIds.includes(completedSequenceId)) {
            cleanup();
            signal?.removeEventListener("abort", onAbort);
            resolve(completedSequenceId);
            return true;
          }
          return false;
        };

        const onAbort = () => {
          cleanup();
          resolve(undefined);
        };

        sequenceCompletedListeners.push(listener);
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    },
    notifyJobOwnershipLost: async (jobId: string) => {
      for (const listener of jobOwnershipLostListeners.slice()) {
        listener(jobId);
      }
    },
    listenJobOwnershipLost: async (jobIds: string[], { signal }: { signal?: AbortSignal }) => {
      return new Promise<string | undefined>((resolve) => {
        if (signal?.aborted) {
          resolve(undefined);
          return;
        }

        const cleanup = () => {
          const index = jobOwnershipLostListeners.indexOf(listener);
          if (index !== -1) {
            jobOwnershipLostListeners.splice(index, 1);
          }
        };

        const listener = (lostJobId: string) => {
          if (jobIds.includes(lostJobId)) {
            cleanup();
            signal?.removeEventListener("abort", onAbort);
            resolve(lostJobId);
            return true;
          }
          return false;
        };

        const onAbort = () => {
          cleanup();
          resolve(undefined);
        };

        jobOwnershipLostListeners.push(listener);
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    },
  };
};
