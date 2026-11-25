import type { NotifyAdapter } from "queuert";

type Listener = () => void;

// #region adapter
export const createMemoryNotifyAdapter = (): NotifyAdapter<"async"> => {
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
    for (const listener of Array.from(channels.get(channel) ?? [])) {
      try {
        listener();
      } catch {}
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
    listenJobsScheduled: async (typeNames, onNotification) => {
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
    listenChainsCompleted: async (chainIds, onNotification) => {
      assertOpen();
      const unsubscribes = chainIds.map((chainId) =>
        subscribe(`chain-completed:${chainId}`, () => {
          onNotification(chainId);
        }),
      );
      return async () => {
        for (const unsubscribe of unsubscribes) unsubscribe();
      };
    },

    notifyJobAttemptsLost: async (jobIds) => {
      assertOpen();
      for (const jobId of jobIds) publish(`job-attempt-lost:${jobId}`);
    },
    listenJobAttemptsLost: async (jobIds, onNotification) => {
      assertOpen();
      const unsubscribes = jobIds.map((jobId) =>
        subscribe(`job-attempt-lost:${jobId}`, () => {
          onNotification(jobId);
        }),
      );
      return async () => {
        for (const unsubscribe of unsubscribes) unsubscribe();
      };
    },

    close,

    [Symbol.asyncDispose]: close,
  };
};
// #endregion
