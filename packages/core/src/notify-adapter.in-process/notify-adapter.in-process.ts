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
  const jobScheduledListeners = new Map<string, Set<(key: string) => void>>();
  const chainCompletedListeners = new Map<string, Set<(key: string) => void>>();
  const jobAttemptLostListeners = new Map<string, Set<(key: string) => void>>();

  const closed = createLatch("NotifyAdapter is closed");

  const notify = (
    listenersByKey: Map<string, Set<(key: string) => void>>,
    keys: string[],
  ): void => {
    closed.throwIfTripped();
    for (const key of keys) {
      const listeners = listenersByKey.get(key);
      if (!listeners) continue;
      for (const listener of Array.from(listeners)) {
        try {
          listener(key);
        } catch {}
      }
    }
  };

  const listen = (
    listenersByKey: Map<string, Set<(key: string) => void>>,
    keys: string[],
    onNotification: (key: string) => void,
  ): (() => void) => {
    closed.throwIfTripped();
    const listener = (key: string): void => {
      onNotification(key);
    };
    for (const key of keys) {
      let listeners = listenersByKey.get(key);
      if (!listeners) {
        listeners = new Set();
        listenersByKey.set(key, listeners);
      }
      listeners.add(listener);
    }

    return () => {
      for (const key of keys) {
        const listeners = listenersByKey.get(key);
        if (!listeners) continue;
        listeners.delete(listener);
        if (listeners.size === 0) listenersByKey.delete(key);
      }
    };
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
      notify(jobScheduledListeners, typeNames);
    },

    listenJobsScheduled: (
      typeNames: string[],
      onNotification: (typeName: string) => void,
    ): (() => void) => listen(jobScheduledListeners, typeNames, onNotification),

    notifyChainsCompleted: (chainIds: string[]): void => {
      notify(chainCompletedListeners, chainIds);
    },

    listenChainsCompleted: (
      chainIds: string[],
      onNotification: (chainId: string) => void,
    ): (() => void) => listen(chainCompletedListeners, chainIds, onNotification),

    notifyJobAttemptsLost: (jobIds: string[]): void => {
      notify(jobAttemptLostListeners, jobIds);
    },

    listenJobAttemptsLost: (
      jobIds: string[],
      onNotification: (jobId: string) => void,
    ): (() => void) => listen(jobAttemptLostListeners, jobIds, onNotification),
  };

  if (mode === "sync") return { ...members, sync: true, close, [Symbol.dispose]: close };
  return {
    notifyJobsScheduled: async (typeNames) => {
      members.notifyJobsScheduled(typeNames);
    },
    listenJobsScheduled: async (typeNames, onNotification) => {
      const dispose = members.listenJobsScheduled(typeNames, onNotification);
      return async () => {
        dispose();
      };
    },
    notifyChainsCompleted: async (chainIds) => {
      members.notifyChainsCompleted(chainIds);
    },
    listenChainsCompleted: async (chainIds, onNotification) => {
      const dispose = members.listenChainsCompleted(chainIds, onNotification);
      return async () => {
        dispose();
      };
    },
    notifyJobAttemptsLost: async (jobIds) => {
      members.notifyJobAttemptsLost(jobIds);
    },
    listenJobAttemptsLost: async (jobIds, onNotification) => {
      const dispose = members.listenJobAttemptsLost(jobIds, onNotification);
      return async () => {
        dispose();
      };
    },
    close: closeAsync,
    [Symbol.asyncDispose]: closeAsync,
  };
}
