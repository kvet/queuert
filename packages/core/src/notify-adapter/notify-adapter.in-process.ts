import { type NotifyAdapter } from "./notify-adapter.js";

const HINT_TTL_MS = 60_000;

export const createInProcessNotifyAdapter = async (): Promise<NotifyAdapter> => {
  const hintCounts = new Map<string, number>();
  const hintTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const jobScheduledListeners = new Map<string, Set<(typeName: string) => void>>();
  const chainCompletedListeners = new Map<string, Set<() => void>>();
  const jobOwnershipLostListeners = new Map<string, Set<() => void>>();

  let closed = false;
  const assertOpen = (): void => {
    if (closed) throw new Error("NotifyAdapter is closed");
  };

  const safeInvoke = (fn: () => void): void => {
    try {
      fn();
    } catch {}
  };

  const refreshTtl = (typeName: string): void => {
    const existing = hintTimers.get(typeName);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      hintCounts.delete(typeName);
      hintTimers.delete(typeName);
    }, HINT_TTL_MS);
    timer.unref();
    hintTimers.set(typeName, timer);
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
    notifyJobScheduled: async (typeName) => {
      assertOpen();
      const listeners = jobScheduledListeners.get(typeName);
      if (!listeners) return;
      for (const listener of Array.from(listeners)) {
        safeInvoke(() => {
          listener(typeName);
        });
      }
    },

    listenJobScheduled: async (typeNames, onNotification) => {
      assertOpen();
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

    provideWakeHint: async (typeName, count) => {
      assertOpen();
      hintCounts.set(typeName, (hintCounts.get(typeName) ?? 0) + count);
      refreshTtl(typeName);
    },

    consumeWakeHint: async (typeName) => {
      assertOpen();
      if (!hintCounts.has(typeName)) return true;
      const count = hintCounts.get(typeName)!;
      if (count > 0) {
        hintCounts.set(typeName, count - 1);
        return true;
      }
      return false;
    },

    notifyChainCompleted: async (chainId: string) => {
      assertOpen();
      const listeners = chainCompletedListeners.get(chainId);
      if (!listeners) return;
      for (const listener of Array.from(listeners)) {
        safeInvoke(listener);
      }
    },

    listenChainCompleted: async (targetChainId, onNotification) => {
      assertOpen();
      const listener = (): void => {
        onNotification();
      };
      addListener(chainCompletedListeners, targetChainId, listener);

      return async () => {
        removeListener(chainCompletedListeners, targetChainId, listener);
      };
    },

    notifyJobOwnershipLost: async (jobId: string) => {
      assertOpen();
      const listeners = jobOwnershipLostListeners.get(jobId);
      if (!listeners) return;
      for (const listener of Array.from(listeners)) {
        safeInvoke(listener);
      }
    },

    listenJobOwnershipLost: async (targetJobId, onNotification) => {
      assertOpen();
      const listener = (): void => {
        onNotification();
      };
      addListener(jobOwnershipLostListeners, targetJobId, listener);

      return async () => {
        removeListener(jobOwnershipLostListeners, targetJobId, listener);
      };
    },

    close: async () => {
      if (closed) return;
      closed = true;
      jobScheduledListeners.clear();
      chainCompletedListeners.clear();
      jobOwnershipLostListeners.clear();
      hintCounts.clear();
      for (const timer of hintTimers.values()) clearTimeout(timer);
      hintTimers.clear();
    },
  };
};
