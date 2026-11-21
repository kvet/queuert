import { type MaybePromise, all, step, syncAsync } from "@queuert/sync-async";

import { type Helpers, runInMode } from "../client/setup-helpers.ts";
import type { BaseTxContext } from "../state-adapter/state-adapter.ts";

type TxNotificationRecord = {
  jobsScheduled: readonly string[];
  chainsCompleted: readonly string[];
  jobAttemptsLost: readonly string[];
  settledJobIds: readonly string[];
};

type TxNotifications = {
  records: Set<TxNotificationRecord>;
  lockedPendingJobs: Map<string, string> | undefined;
  flushed: boolean;
};

export type TxNotificationsByTransaction = WeakMap<object, TxNotifications>;

const none: readonly never[] = [];

const flushTxNotifications = syncAsync(function* (
  helpers: Helpers,
  key: object,
  notifications: TxNotifications,
) {
  if (notifications.flushed) return;
  notifications.flushed = true;
  helpers.txNotifications.delete(key);
  const jobsScheduled: string[] = [];
  const chainsCompleted: string[] = [];
  const jobAttemptsLost: string[] = [];
  const settledJobIds = new Set<string>();
  for (const record of notifications.records) {
    jobsScheduled.push(...record.jobsScheduled);
    chainsCompleted.push(...record.chainsCompleted);
    jobAttemptsLost.push(...record.jobAttemptsLost);
    for (const jobId of record.settledJobIds) settledJobIds.add(jobId);
  }
  for (const [jobId, typeName] of notifications.lockedPendingJobs ?? none) {
    if (!settledJobIds.has(jobId)) jobsScheduled.push(typeName);
  }
  yield* step(
    all([
      jobsScheduled.length > 0
        ? helpers.notifyHelper.notifyJobsScheduled(jobsScheduled)
        : undefined,
      chainsCompleted.length > 0
        ? helpers.notifyHelper.notifyChainsCompleted(chainsCompleted)
        : undefined,
      jobAttemptsLost.length > 0
        ? helpers.notifyHelper.notifyJobAttemptsLost(jobAttemptsLost)
        : undefined,
    ]),
  );
});

const wakeLockedPendingJobs = syncAsync(function* (
  helpers: Helpers,
  key: object,
  notifications: TxNotifications,
) {
  if (notifications.flushed) return;
  notifications.flushed = true;
  helpers.txNotifications.delete(key);
  if (notifications.lockedPendingJobs === undefined) return;
  yield* step(
    helpers.notifyHelper.notifyJobsScheduled([...notifications.lockedPendingJobs.values()]),
  );
});

export const notifyAfterTransaction = (
  helpers: Helpers,
  txCtx: BaseTxContext,
  {
    jobsScheduled = none,
    chainsCompleted = none,
    jobAttemptsLost = none,
    settledJobIds = none,
    lockedPendingJobs = none,
  }: Partial<TxNotificationRecord> & {
    lockedPendingJobs?: readonly { id: string; typeName: string }[];
  },
): void => {
  if (
    jobsScheduled.length === 0 &&
    chainsCompleted.length === 0 &&
    jobAttemptsLost.length === 0 &&
    settledJobIds.length === 0 &&
    lockedPendingJobs.length === 0
  ) {
    return;
  }
  const key = helpers.stateAdapter.getTransaction(txCtx);
  if (key === undefined) {
    throw new Error(
      "Notifications after a transaction require a context inside an open transaction",
    );
  }
  const existing = helpers.txNotifications.get(key);
  const notifications: TxNotifications = existing ?? {
    records: new Set(),
    lockedPendingJobs: undefined,
    flushed: false,
  };
  if (existing === undefined) helpers.txNotifications.set(key, notifications);
  const record: TxNotificationRecord = {
    jobsScheduled,
    chainsCompleted,
    jobAttemptsLost,
    settledJobIds,
  };
  notifications.records.add(record);
  if (lockedPendingJobs.length > 0) {
    const locked = (notifications.lockedPendingJobs ??= new Map());
    for (const { id, typeName } of lockedPendingJobs) {
      locked.set(id, typeName);
    }
  }
  const flush = () => runInMode(helpers, flushTxNotifications, helpers, key, notifications);

  const onRollback = (): MaybePromise<void> => {
    notifications.records.delete(record);
    if (helpers.stateAdapter.getTransaction(txCtx) === undefined) {
      return runInMode(helpers, wakeLockedPendingJobs, helpers, key, notifications);
    }
    if (lockedPendingJobs.length === 0) return;
    helpers.stateAdapter.onTransactionCommit(txCtx, flush);
    helpers.stateAdapter.onTransactionRollback(txCtx, onRollback);
    return helpers.notifyHelper.notifyJobsScheduled(
      lockedPendingJobs.map(({ typeName }) => typeName),
    );
  };

  helpers.stateAdapter.onTransactionCommit(txCtx, flush);
  helpers.stateAdapter.onTransactionRollback(txCtx, onRollback);
};
