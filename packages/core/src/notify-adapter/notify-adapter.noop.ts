import type { ListenResult, NotifyAdapter } from "./notify-adapter.js";

const createNoopListener = <T>() => {
  let resolve: ((result: ListenResult<T>) => void) | null = null;
  let disposed = false;

  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    if (resolve) {
      resolve({ received: false });
      resolve = null;
    }
  };

  return {
    wait: async (opts?: { signal?: AbortSignal }): Promise<ListenResult<T>> => {
      if (disposed) {
        return { received: false };
      }

      return new Promise<ListenResult<T>>((res) => {
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
};

export const createNoopNotifyAdapter = (): NotifyAdapter => {
  return {
    notifyJobScheduled: async () => {},
    listenJobScheduled: async () => createNoopListener<string>(),
    notifyJobSequenceCompleted: async () => {},
    listenJobSequenceCompleted: async () => createNoopListener<void>(),
    notifyJobOwnershipLost: async () => {},
    listenJobOwnershipLost: async () => createNoopListener<void>(),
  };
};
