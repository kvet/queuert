import { type MaybePromise, andThen, tryCatch } from "@queuert/helpers/maybe-promise";

import { isSyncAdapter } from "../adapter-mode.ts";
import type { AnyNotifyAdapter } from "./notify-adapter.ts";

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

const ignoreError = (): void => {};

const sendNow =
  (notify: (values: string[]) => MaybePromise<void>) =>
  (values: string[]): MaybePromise<void> => {
    if (values.length === 0) return;
    return tryCatch(() => notify([...new Set(values)]), ignoreError);
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

const noopDispose = (): void => {};

const listen = (subscribe: () => MaybePromise<Dispose>): MaybePromise<Dispose> =>
  tryCatch(
    () =>
      andThen(
        subscribe(),
        (dispose): Dispose =>
          () =>
            tryCatch(dispose, ignoreError),
      ),
    (): Dispose => noopDispose,
  );

export const createNotifyHelper = ({ adapter }: { adapter: AnyNotifyAdapter }): NotifyHelper => {
  const batch = isSyncAdapter(adapter) ? sendNow : batchPerTick;
  const notifyAdapter = adapter;

  return {
    notifyJobsScheduled: batch((typeNames) => notifyAdapter.notifyJobsScheduled(typeNames)),
    notifyChainsCompleted: batch((chainIds) => notifyAdapter.notifyChainsCompleted(chainIds)),
    notifyJobAttemptsLost: batch((jobIds) => notifyAdapter.notifyJobAttemptsLost(jobIds)),
    listenJobScheduled: (typeNames, onNotification) =>
      listen(() => notifyAdapter.listenJobScheduled(typeNames, onNotification)),
    listenChainCompleted: (chainId, onNotification) =>
      listen(() => notifyAdapter.listenChainCompleted(chainId, onNotification)),
    listenJobAttemptLost: (jobId, onNotification) =>
      listen(() => notifyAdapter.listenJobAttemptLost(jobId, onNotification)),
  };
};
