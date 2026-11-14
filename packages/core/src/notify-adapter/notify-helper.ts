import { type MaybePromise, type Mode, step, syncAsync } from "@queuert/sync-async";

import type { NotifyAdapter } from "./notify-adapter.ts";

type Dispose = () => MaybePromise<void>;

export type NotifyHelper = {
  notifyJobsScheduled: (typeNames: string[]) => MaybePromise<void>;
  notifyChainsCompleted: (chainIds: string[]) => MaybePromise<void>;
  notifyJobAttemptsLost: (jobIds: string[]) => MaybePromise<void>;
  listenJobScheduled: (
    typeNames: string[],
    onNotification: (typeName: string) => void,
  ) => MaybePromise<Dispose>;
  listenChainCompleted: (chainId: string, onNotification: () => void) => MaybePromise<Dispose>;
  listenJobAttemptLost: (jobId: string, onNotification: () => void) => MaybePromise<Dispose>;
};

const sendQuietly = syncAsync(function* (
  notify: (values: string[]) => MaybePromise<void>,
  values: string[],
) {
  if (values.length === 0) return;
  try {
    yield* step(notify(values.length === 1 ? values : [...new Set(values)]));
  } catch {}
});

const sendNow =
  (notify: (values: string[]) => MaybePromise<void>) =>
  (values: string[]): void => {
    sendQuietly.sync(notify, values);
  };

const batchPerTick = (notify: (values: string[]) => MaybePromise<void>) => {
  let pending: Set<string> | undefined;
  let sending: Promise<void> = Promise.resolve();
  const sendPending = async (): Promise<void> => {
    const batch = pending!;
    pending = undefined;
    try {
      await notify(Array.from(batch));
    } catch {}
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

const noopDispose: Dispose = () => {};

const disposeQuietly = syncAsync(function* (dispose: Dispose) {
  try {
    yield* step(dispose());
  } catch {}
});

const listenQuietly = syncAsync(function* (
  subscribe: () => MaybePromise<Dispose>,
  dispose: (dispose: Dispose) => MaybePromise<void>,
) {
  try {
    const subscribed = yield* step(subscribe());
    return (): MaybePromise<void> => dispose(subscribed);
  } catch {
    return noopDispose;
  }
});

export const createNotifyHelper = ({ adapter }: { adapter: NotifyAdapter<Mode> }): NotifyHelper => {
  const sync = adapter.sync === true;
  const batch = sync ? sendNow : batchPerTick;
  const dispose = sync ? disposeQuietly.sync : disposeQuietly.async;
  const subscribe = sync ? listenQuietly.sync : listenQuietly.async;
  const notifyAdapter = adapter;

  return {
    notifyJobsScheduled: batch((typeNames) => notifyAdapter.notifyJobsScheduled(typeNames)),
    notifyChainsCompleted: batch((chainIds) => notifyAdapter.notifyChainsCompleted(chainIds)),
    notifyJobAttemptsLost: batch((jobIds) => notifyAdapter.notifyJobAttemptsLost(jobIds)),
    listenJobScheduled: (typeNames, onNotification) =>
      subscribe(() => notifyAdapter.listenJobScheduled(typeNames, onNotification), dispose),
    listenChainCompleted: (chainId, onNotification) =>
      subscribe(() => notifyAdapter.listenChainCompleted(chainId, onNotification), dispose),
    listenJobAttemptLost: (jobId, onNotification) =>
      subscribe(() => notifyAdapter.listenJobAttemptLost(jobId, onNotification), dispose),
  };
};
