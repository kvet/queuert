import { noop, noopAsync } from "@queuert/helpers/noop";

import type { NotifyAdapter } from "./notify-adapter.ts";

export type NotifyHelper = {
  notifyJobsScheduled: (typeNames: string[]) => Promise<void>;
  notifyChainsCompleted: (chainIds: string[]) => Promise<void>;
  notifyJobAttemptsLost: (jobIds: string[]) => Promise<void>;
  listenJobScheduled: NotifyAdapter["listenJobScheduled"];
  listenChainCompleted: NotifyAdapter["listenChainCompleted"];
  listenJobAttemptLost: NotifyAdapter["listenJobAttemptLost"];
};

const batchNotify = (notify: (values: string[]) => Promise<void>) => {
  let pending: Set<string> | undefined;
  let sending: Promise<void> = Promise.resolve();
  const sendPending = async (): Promise<void> => {
    const batch = pending!;
    pending = undefined;
    return notify(Array.from(batch)).catch(noop);
  };
  return async (values: string[]): Promise<void> => {
    if (values.length === 0) return;
    if (pending === undefined) {
      pending = new Set(values);
      sending = Promise.resolve().then(sendPending);
    } else {
      for (const value of values) pending.add(value);
    }
    return sending;
  };
};

export const createNotifyHelper = ({ adapter }: { adapter: NotifyAdapter }): NotifyHelper => ({
  notifyJobsScheduled: batchNotify(async (typeNames) => adapter.notifyJobsScheduled(typeNames)),
  notifyChainsCompleted: batchNotify(async (chainIds) => adapter.notifyChainsCompleted(chainIds)),
  notifyJobAttemptsLost: batchNotify(async (jobIds) => adapter.notifyJobAttemptsLost(jobIds)),
  listenJobScheduled: async (typeNames, onNotification) =>
    adapter.listenJobScheduled(typeNames, onNotification).catch(() => noopAsync),
  listenChainCompleted: async (chainId, onNotification) =>
    adapter.listenChainCompleted(chainId, onNotification).catch(() => noopAsync),
  listenJobAttemptLost: async (jobId, onNotification) =>
    adapter.listenJobAttemptLost(jobId, onNotification).catch(() => noopAsync),
});
