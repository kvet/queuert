import { createLatch } from "@queuert/helpers/latch";
import type { Mode } from "@queuert/sync-async";

import type { NotifyAdapter } from "../notify-adapter/notify-adapter.ts";

/**
 * Create a notify adapter that delivers notifications through in-process callbacks. Only clients
 * and worker runners in this process are notified, so it suits single-process deployments.
 *
 * It is synchronous by default: every method returns its result directly. With `mode: "async"`
 * its methods return promises.
 *
 * @param options - In-process notify adapter configuration.
 */
export function createInProcessNotifyAdapter(options?: { mode?: "sync" }): NotifyAdapter<"sync">;
export function createInProcessNotifyAdapter(options: { mode: "async" }): NotifyAdapter<"async">;
export function createInProcessNotifyAdapter(options: { mode: Mode }): NotifyAdapter<Mode>;
export function createInProcessNotifyAdapter({
  mode = "sync",
}: { mode?: Mode } = {}): NotifyAdapter<Mode> {
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
  const closeAsync = async (): Promise<void> => {
    close();
  };

  const members = {
    notifyJobsScheduled: (typeNames: string[]): void => {
      closed.throwIfTripped();
      for (const typeName of typeNames) {
        const listeners = jobScheduledListeners.get(typeName);
        if (!listeners) continue;
        for (const listener of Array.from(listeners)) {
          try {
            listener(typeName);
          } catch {}
        }
      }
    },

    listenJobScheduled: (
      typeNames: string[],
      onNotification: (typeName: string) => void,
    ): (() => void) => {
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

    notifyChainsCompleted: (chainIds: string[]): void => {
      closed.throwIfTripped();
      for (const chainId of chainIds) {
        const listeners = chainCompletedListeners.get(chainId);
        if (!listeners) continue;
        for (const listener of Array.from(listeners)) {
          try {
            listener();
          } catch {}
        }
      }
    },

    listenChainCompleted: (targetChainId: string, onNotification: () => void): (() => void) => {
      closed.throwIfTripped();
      const listener = (): void => {
        onNotification();
      };
      addListener(chainCompletedListeners, targetChainId, listener);

      return () => {
        removeListener(chainCompletedListeners, targetChainId, listener);
      };
    },

    notifyJobAttemptsLost: (jobIds: string[]): void => {
      closed.throwIfTripped();
      for (const jobId of jobIds) {
        const listeners = jobAttemptLostListeners.get(jobId);
        if (!listeners) continue;
        for (const listener of Array.from(listeners)) {
          try {
            listener();
          } catch {}
        }
      }
    },

    listenJobAttemptLost: (targetJobId: string, onNotification: () => void): (() => void) => {
      closed.throwIfTripped();
      const listener = (): void => {
        onNotification();
      };
      addListener(jobAttemptLostListeners, targetJobId, listener);

      return () => {
        removeListener(jobAttemptLostListeners, targetJobId, listener);
      };
    },
  };

  if (mode === "sync") return { ...members, sync: true, close, [Symbol.dispose]: close };
  return {
    notifyJobsScheduled: async (typeNames) => {
      members.notifyJobsScheduled(typeNames);
    },
    listenJobScheduled: async (typeNames, onNotification) => {
      const dispose = members.listenJobScheduled(typeNames, onNotification);
      return async () => {
        dispose();
      };
    },
    notifyChainsCompleted: async (chainIds) => {
      members.notifyChainsCompleted(chainIds);
    },
    listenChainCompleted: async (targetChainId, onNotification) => {
      const dispose = members.listenChainCompleted(targetChainId, onNotification);
      return async () => {
        dispose();
      };
    },
    notifyJobAttemptsLost: async (jobIds) => {
      members.notifyJobAttemptsLost(jobIds);
    },
    listenJobAttemptLost: async (targetJobId, onNotification) => {
      const dispose = members.listenJobAttemptLost(targetJobId, onNotification);
      return async () => {
        dispose();
      };
    },
    close: closeAsync,
    [Symbol.asyncDispose]: closeAsync,
  };
}
