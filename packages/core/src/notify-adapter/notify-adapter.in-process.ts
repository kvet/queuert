import type { ListenResult, NotifyAdapter } from "./notify-adapter.js";

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
    listenJobScheduled: async (typeNames: string[]) => {
      let resolve: ((result: ListenResult<string>) => void) | null = null;
      let disposed = false;

      const listener = ({ typeName, hintId }: JobScheduledNotification) => {
        if (typeNames.includes(typeName) && resolve) {
          if (tryConsumeHint(hintId)) {
            resolve({ received: true, value: typeName });
            resolve = null;
          }
        }
      };

      jobScheduledListeners.push(listener);

      const dispose = async () => {
        if (disposed) return;
        disposed = true;
        const index = jobScheduledListeners.indexOf(listener);
        if (index !== -1) {
          jobScheduledListeners.splice(index, 1);
        }
        if (resolve) {
          resolve({ received: false });
          resolve = null;
        }
      };

      return {
        wait: async (opts?: { signal?: AbortSignal }): Promise<ListenResult<string>> => {
          if (disposed) {
            return { received: false };
          }

          return new Promise<ListenResult<string>>((res) => {
            if (opts?.signal?.aborted) {
              res({ received: false });
              return;
            }

            resolve = res;

            const onAbort = () => {
              if (resolve === res) {
                resolve = null;
                res({ received: false });
              }
            };

            opts?.signal?.addEventListener("abort", onAbort, { once: true });
          });
        },
        dispose,
      };
    },
    notifyJobSequenceCompleted: async (sequenceId: string) => {
      for (const listener of sequenceCompletedListeners.slice()) {
        listener(sequenceId);
      }
    },
    listenJobSequenceCompleted: async (targetSequenceId: string) => {
      let resolve: ((result: ListenResult<void>) => void) | null = null;
      let disposed = false;

      const listener = (sequenceId: string) => {
        if (sequenceId === targetSequenceId && resolve) {
          resolve({ received: true, value: undefined });
          resolve = null;
        }
      };

      sequenceCompletedListeners.push(listener);

      const dispose = async () => {
        if (disposed) return;
        disposed = true;
        const index = sequenceCompletedListeners.indexOf(listener);
        if (index !== -1) {
          sequenceCompletedListeners.splice(index, 1);
        }
        if (resolve) {
          resolve({ received: false });
          resolve = null;
        }
      };

      return {
        wait: async (opts?: { signal?: AbortSignal }): Promise<ListenResult<void>> => {
          if (disposed) {
            return { received: false };
          }

          return new Promise<ListenResult<void>>((res) => {
            if (opts?.signal?.aborted) {
              res({ received: false });
              return;
            }

            resolve = res;

            const onAbort = () => {
              if (resolve === res) {
                resolve = null;
                res({ received: false });
              }
            };

            opts?.signal?.addEventListener("abort", onAbort, { once: true });
          });
        },
        dispose,
      };
    },
    notifyJobOwnershipLost: async (jobId: string) => {
      for (const listener of jobOwnershipLostListeners.slice()) {
        listener(jobId);
      }
    },
    listenJobOwnershipLost: async (targetJobId: string) => {
      let resolve: ((result: ListenResult<void>) => void) | null = null;
      let disposed = false;

      const listener = (jobId: string) => {
        if (jobId === targetJobId && resolve) {
          resolve({ received: true, value: undefined });
          resolve = null;
        }
      };

      jobOwnershipLostListeners.push(listener);

      const dispose = async () => {
        if (disposed) return;
        disposed = true;
        const index = jobOwnershipLostListeners.indexOf(listener);
        if (index !== -1) {
          jobOwnershipLostListeners.splice(index, 1);
        }
        if (resolve) {
          resolve({ received: false });
          resolve = null;
        }
      };

      return {
        wait: async (opts?: { signal?: AbortSignal }): Promise<ListenResult<void>> => {
          if (disposed) {
            return { received: false };
          }

          return new Promise<ListenResult<void>>((res) => {
            if (opts?.signal?.aborted) {
              res({ received: false });
              return;
            }

            resolve = res;

            const onAbort = () => {
              if (resolve === res) {
                resolve = null;
                res({ received: false });
              }
            };

            opts?.signal?.addEventListener("abort", onAbort, { once: true });
          });
        },
        dispose,
      };
    },
  };
};
