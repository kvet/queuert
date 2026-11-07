import { createLatch } from "@queuert/helpers";

import type { NotifyAdapter } from "./notify-adapter.ts";

/** Creates an in-memory notify adapter for single-process deployments, delivering notifications through in-process callbacks. */
export const createInProcessNotifyAdapter = (): NotifyAdapter => {
  const jobScheduledListeners = new Map<string, Set<(typeName: string) => void>>();
  const chainCompletedListeners = new Map<string, Set<() => void>>();
  const jobAttemptLostListeners = new Map<string, Set<() => void>>();

  const closed = createLatch("NotifyAdapter is closed");

  const safeInvoke = (fn: () => void): void => {
    try {
      fn();
    } catch {}
  };

  const addListener = <V>(map: Map<string, Set<V>>, key: string, value: V): void => {
    let set = map.get(key);
    if (!set) {
      set = new Set();
      map.set(key, set);
    }
    set.add(value);
  };

  const removeListener = <V>(map: Map<string, Set<V>>, key: string, value: V): void => {
    const set = map.get(key);
    if (!set) return;
    set.delete(value);
    if (set.size === 0) map.delete(key);
  };

  return {
    notifyJobsScheduled: async (typeNames) => {
      closed.throwIfTripped();
      for (const typeName of typeNames) {
        const listeners = jobScheduledListeners.get(typeName);
        if (!listeners) continue;
        for (const listener of Array.from(listeners)) {
          safeInvoke(() => {
            listener(typeName);
          });
        }
      }
    },

    listenJobScheduled: async (typeNames, onNotification) => {
      closed.throwIfTripped();
      const listener = (typeName: string): void => {
        onNotification(typeName);
      };
      for (const typeName of typeNames) {
        addListener(jobScheduledListeners, typeName, listener);
      }

      return async () => {
        for (const typeName of typeNames) {
          removeListener(jobScheduledListeners, typeName, listener);
        }
      };
    },

    notifyChainsCompleted: async (chainIds) => {
      closed.throwIfTripped();
      for (const chainId of chainIds) {
        const listeners = chainCompletedListeners.get(chainId);
        if (!listeners) continue;
        for (const listener of Array.from(listeners)) {
          safeInvoke(listener);
        }
      }
    },

    listenChainCompleted: async (targetChainId, onNotification) => {
      closed.throwIfTripped();
      const listener = (): void => {
        onNotification();
      };
      addListener(chainCompletedListeners, targetChainId, listener);

      return async () => {
        removeListener(chainCompletedListeners, targetChainId, listener);
      };
    },

    notifyJobAttemptsLost: async (jobIds) => {
      closed.throwIfTripped();
      for (const jobId of jobIds) {
        const listeners = jobAttemptLostListeners.get(jobId);
        if (!listeners) continue;
        for (const listener of Array.from(listeners)) {
          safeInvoke(listener);
        }
      }
    },

    listenJobAttemptLost: async (targetJobId, onNotification) => {
      closed.throwIfTripped();
      const listener = (): void => {
        onNotification();
      };
      addListener(jobAttemptLostListeners, targetJobId, listener);

      return async () => {
        removeListener(jobAttemptLostListeners, targetJobId, listener);
      };
    },

    close: async () => {
      if (!closed.trip()) return;
      jobScheduledListeners.clear();
      chainCompletedListeners.clear();
      jobAttemptLostListeners.clear();
    },
  };
};
