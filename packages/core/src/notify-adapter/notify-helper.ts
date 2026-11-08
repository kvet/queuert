import { noop, noopAsync } from "@queuert/helpers";

import type { TxHooks } from "../tx-hooks/tx-hooks.ts";
import type { NotifyAdapter } from "./notify-adapter.ts";

type NotifyTxHooks = Pick<TxHooks, "onCommit">;

export type NotifyHelper = {
  notifyJobsScheduled: (txHooks: NotifyTxHooks, typeNames: string[]) => void;
  notifyChainsCompleted: (txHooks: NotifyTxHooks, chainIds: string[]) => void;
  notifyJobAttemptsLost: (txHooks: NotifyTxHooks, jobIds: string[]) => void;
  listenJobScheduled: NotifyAdapter["listenJobScheduled"];
  listenChainCompleted: NotifyAdapter["listenChainCompleted"];
  listenJobAttemptLost: NotifyAdapter["listenJobAttemptLost"];
};

const notifyOnCommit = (notify: (values: string[]) => Promise<void>) => {
  let pending: Set<string> | undefined;
  let sending: Promise<void> = Promise.resolve();
  const sendPending = async (): Promise<void> => {
    const batch = pending!;
    pending = undefined;
    return notify(Array.from(batch)).catch(noop);
  };
  const send = async (values: string[]): Promise<void> => {
    if (pending === undefined) {
      pending = new Set(values);
      sending = Promise.resolve().then(sendPending);
    } else {
      for (const value of values) pending.add(value);
    }
    return sending;
  };
  return (txHooks: NotifyTxHooks, values: string[]): void => {
    if (values.length === 0) return;
    txHooks.onCommit(async () => send(values));
  };
};

export const createNotifyHelper = ({ adapter }: { adapter: NotifyAdapter }): NotifyHelper => ({
  notifyJobsScheduled: notifyOnCommit(async (typeNames) => adapter.notifyJobsScheduled(typeNames)),
  notifyChainsCompleted: notifyOnCommit(async (chainIds) =>
    adapter.notifyChainsCompleted(chainIds),
  ),
  notifyJobAttemptsLost: notifyOnCommit(async (jobIds) => adapter.notifyJobAttemptsLost(jobIds)),
  listenJobScheduled: async (typeNames, onNotification) =>
    adapter.listenJobScheduled(typeNames, onNotification).catch(() => noopAsync),
  listenChainCompleted: async (chainId, onNotification) =>
    adapter.listenChainCompleted(chainId, onNotification).catch(() => noopAsync),
  listenJobAttemptLost: async (jobId, onNotification) =>
    adapter.listenJobAttemptLost(jobId, onNotification).catch(() => noopAsync),
});
