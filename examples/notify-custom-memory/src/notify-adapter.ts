import type { NotifyAdapter } from "queuert";

type Listener = () => void;

// #region adapter
/** Creates a notify adapter that delivers notifications to listeners in the same process. */
export const createMemoryNotifyAdapter = (): NotifyAdapter => {
  const channels = new Map<string, Set<Listener>>();
  let closed = false;

  const assertOpen = (): void => {
    if (closed) throw new Error("Notify adapter is closed");
  };

  const subscribe = (channel: string, listener: Listener): (() => void) => {
    const listeners = channels.get(channel) ?? new Set<Listener>();
    listeners.add(listener);
    channels.set(channel, listeners);

    return () => {
      const current = channels.get(channel);
      current?.delete(listener);
      if (current?.size === 0) channels.delete(channel);
    };
  };

  const publish = (channel: string): void => {
    // Iterate a copy so a listener can subscribe or unsubscribe while it is being called
    for (const listener of Array.from(channels.get(channel) ?? [])) {
      try {
        listener();
      } catch {
        // A throwing listener must not keep the others from hearing the notification
      }
    }
  };

  const close = async (): Promise<void> => {
    closed = true;
    channels.clear();
  };

  return {
    notifyJobsScheduled: async (typeNames) => {
      assertOpen();
      for (const typeName of typeNames) publish(`job-scheduled:${typeName}`);
    },
    listenJobScheduled: async (typeNames, onNotification) => {
      assertOpen();
      const unsubscribes = typeNames.map((typeName) =>
        subscribe(`job-scheduled:${typeName}`, () => {
          onNotification(typeName);
        }),
      );
      return async () => {
        for (const unsubscribe of unsubscribes) unsubscribe();
      };
    },

    notifyChainsCompleted: async (chainIds) => {
      assertOpen();
      for (const chainId of chainIds) publish(`chain-completed:${chainId}`);
    },
    listenChainCompleted: async (chainId, onNotification) => {
      assertOpen();
      const unsubscribe = subscribe(`chain-completed:${chainId}`, () => {
        onNotification();
      });
      return async () => {
        unsubscribe();
      };
    },

    notifyJobAttemptsLost: async (jobIds) => {
      assertOpen();
      for (const jobId of jobIds) publish(`job-attempt-lost:${jobId}`);
    },
    listenJobAttemptLost: async (jobId, onNotification) => {
      assertOpen();
      const unsubscribe = subscribe(`job-attempt-lost:${jobId}`, () => {
        onNotification();
      });
      return async () => {
        unsubscribe();
      };
    },

    close,

    [Symbol.asyncDispose]: close,
  };
};
// #endregion
