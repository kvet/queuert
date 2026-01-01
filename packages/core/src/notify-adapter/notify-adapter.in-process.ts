import type { ListenResult, NotifyAdapter } from "./notify-adapter.js";

type JobScheduledWaiter = {
  typeNames: string[];
  resolve: (result: ListenResult<string>) => void;
};

export const createInProcessNotifyAdapter = (): NotifyAdapter => {
  // Job scheduled uses queue semantics - only ONE worker gets each notification
  const jobScheduledWaiters: JobScheduledWaiter[] = [];

  // Sequence completed and ownership lost use broadcast semantics - all listeners get notified
  const sequenceCompletedListeners: Array<(sequenceId: string) => void> = [];
  const jobOwnershipLostListeners: Array<(jobId: string) => void> = [];

  return {
    notifyJobScheduled: async (typeName: string) => {
      // Find first waiter interested in this type and notify only that one
      const index = jobScheduledWaiters.findIndex((w) => w.typeNames.includes(typeName));
      if (index !== -1) {
        const waiter = jobScheduledWaiters.splice(index, 1)[0];
        waiter.resolve({ received: true, value: typeName });
      }
    },
    listenJobScheduled: async (typeNames: string[]) => {
      let resolve: ((result: ListenResult<string>) => void) | null = null;
      let disposed = false;

      const dispose = async () => {
        if (disposed) return;
        disposed = true;
        if (resolve) {
          const index = jobScheduledWaiters.findIndex((w) => w.resolve === resolve);
          if (index !== -1) {
            jobScheduledWaiters.splice(index, 1);
          }
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
            jobScheduledWaiters.push({ typeNames, resolve: res });

            const onAbort = () => {
              if (resolve === res) {
                const index = jobScheduledWaiters.findIndex((w) => w.resolve === res);
                if (index !== -1) {
                  jobScheduledWaiters.splice(index, 1);
                }
                resolve = null;
                res({ received: false });
              }
            };

            opts?.signal?.addEventListener("abort", onAbort, { once: true });
          });
        },
        dispose,
        [Symbol.asyncDispose]: dispose,
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
        [Symbol.asyncDispose]: dispose,
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
        [Symbol.asyncDispose]: dispose,
      };
    },
  };
};
