import { createLatch } from "@queuert/helpers/latch";
import { safeInvoke } from "@queuert/helpers/safe-invoke";

import type { NotifyAdapter, SyncNotifyAdapter } from "../notify-adapter/notify-adapter.ts";

/**
 * Synchronous variant of {@link createInProcessNotifyAdapter}: every method returns its result
 * directly.
 */
export const createSyncInProcessNotifyAdapter = (): SyncNotifyAdapter => {
  const jobScheduledListeners = new Map<string, Set<(typeName: string) => void>>();
  const chainCompletedListeners = new Map<string, Set<() => void>>();
  const jobAttemptLostListeners = new Map<string, Set<() => void>>();

  const closed = createLatch("NotifyAdapter is closed");

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

  const close = (): void => {
    if (!closed.trip()) return;
    jobScheduledListeners.clear();
    chainCompletedListeners.clear();
    jobAttemptLostListeners.clear();
  };

  return {
    sync: true,
    notifyJobsScheduled: (typeNames) => {
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

    listenJobScheduled: (typeNames, onNotification) => {
      closed.throwIfTripped();
      const listener = (typeName: string): void => {
        onNotification(typeName);
      };
      for (const typeName of typeNames) {
        addListener(jobScheduledListeners, typeName, listener);
      }

      return () => {
        for (const typeName of typeNames) {
          removeListener(jobScheduledListeners, typeName, listener);
        }
      };
    },

    notifyChainsCompleted: (chainIds) => {
      closed.throwIfTripped();
      for (const chainId of chainIds) {
        const listeners = chainCompletedListeners.get(chainId);
        if (!listeners) continue;
        for (const listener of Array.from(listeners)) {
          safeInvoke(listener);
        }
      }
    },

    listenChainCompleted: (targetChainId, onNotification) => {
      closed.throwIfTripped();
      const listener = (): void => {
        onNotification();
      };
      addListener(chainCompletedListeners, targetChainId, listener);

      return () => {
        removeListener(chainCompletedListeners, targetChainId, listener);
      };
    },

    notifyJobAttemptsLost: (jobIds) => {
      closed.throwIfTripped();
      for (const jobId of jobIds) {
        const listeners = jobAttemptLostListeners.get(jobId);
        if (!listeners) continue;
        for (const listener of Array.from(listeners)) {
          safeInvoke(listener);
        }
      }
    },

    listenJobAttemptLost: (targetJobId, onNotification) => {
      closed.throwIfTripped();
      const listener = (): void => {
        onNotification();
      };
      addListener(jobAttemptLostListeners, targetJobId, listener);

      return () => {
        removeListener(jobAttemptLostListeners, targetJobId, listener);
      };
    },

    close,
    [Symbol.dispose]: close,
  };
};

/**
 * Create a notify adapter that delivers notifications through in-process callbacks. Only clients
 * and worker runners in this process are notified, so it suits single-process deployments.
 */
export const createInProcessNotifyAdapter = (): NotifyAdapter => {
  const adapter = createSyncInProcessNotifyAdapter();
  const promisifyDispose = (dispose: () => void) => async (): Promise<void> => {
    dispose();
  };
  const close = async (): Promise<void> => {
    adapter.close();
  };
  return {
    notifyJobsScheduled: async (typeNames) => {
      adapter.notifyJobsScheduled(typeNames);
    },
    listenJobScheduled: async (typeNames, onNotification) =>
      promisifyDispose(adapter.listenJobScheduled(typeNames, onNotification)),
    notifyChainsCompleted: async (chainIds) => {
      adapter.notifyChainsCompleted(chainIds);
    },
    listenChainCompleted: async (chainId, onNotification) =>
      promisifyDispose(adapter.listenChainCompleted(chainId, onNotification)),
    notifyJobAttemptsLost: async (jobIds) => {
      adapter.notifyJobAttemptsLost(jobIds);
    },
    listenJobAttemptLost: async (jobId, onNotification) =>
      promisifyDispose(adapter.listenJobAttemptLost(jobId, onNotification)),
    close,
    [Symbol.asyncDispose]: close,
  };
};
