import { type MaybePromise, all, step, syncAsync } from "@queuert/sync-async";

import { type Helpers, runInMode } from "../client/setup-helpers.ts";
import type { BaseTxContext } from "../state-adapter/state-adapter.ts";

type TxNotifications = {
  jobsScheduled: readonly string[];
  chainsCompleted: readonly string[];
  jobAttemptsLost: readonly string[];
  settledJobIds: readonly string[];
  lockedPendingJobs: readonly { id: string; typeName: string }[];
};

export type TxEffects = {
  onCommit: (effect: () => void) => void;
  onRollback: (effect: () => void) => void;
  notify: (notifications: Partial<TxNotifications>) => void;
};

type TxCall = TxEffects & {
  commits: (() => void)[];
  rollbacks: (() => void)[];
  notifications: Partial<TxNotifications>[];
};

type TxState = {
  calls: Set<TxCall>;
  lockedPendingJobs: Map<string, string>;
  commit: () => MaybePromise<void>;
};

export type TxEffectsByTransaction = WeakMap<object, TxState>;

const notificationsOf = <K extends keyof TxNotifications>(
  calls: readonly TxCall[],
  kind: K,
): TxNotifications[K][number][] => {
  const values: TxNotifications[K][number][] = [];
  for (const call of calls) {
    for (const notifications of call.notifications) {
      for (const value of notifications[kind] ?? []) values.push(value);
    }
  }
  return values;
};

const runEffects = (effects: readonly (() => void)[]): { error: unknown } | undefined => {
  let failure: { error: unknown } | undefined;
  for (const effect of effects) {
    try {
      effect();
    } catch (error) {
      failure ??= { error };
    }
  }
  return failure;
};

const commitTransaction = syncAsync(function* (helpers: Helpers, key: object, state: TxState) {
  if (!helpers.txEffects.delete(key)) return;
  const calls = [...state.calls];
  const failure = runEffects(calls.flatMap((call) => call.commits));
  const settledJobIds = new Set(notificationsOf(calls, "settledJobIds"));
  const jobsScheduled = [
    ...notificationsOf(calls, "jobsScheduled"),
    ...[...state.lockedPendingJobs].flatMap(([jobId, typeName]) =>
      settledJobIds.has(jobId) ? [] : [typeName],
    ),
  ];
  const chainsCompleted = notificationsOf(calls, "chainsCompleted");
  const jobAttemptsLost = notificationsOf(calls, "jobAttemptsLost");
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
  // oxlint-disable-next-line typescript/only-throw-error -- re-throwing a commit effect's error
  if (failure) throw failure.error;
});

const wakeAfterTransactionRollback = syncAsync(function* (
  helpers: Helpers,
  key: object,
  state: TxState,
) {
  if (!helpers.txEffects.delete(key)) return;
  if (state.lockedPendingJobs.size === 0) return;
  yield* step(helpers.notifyHelper.notifyJobsScheduled([...state.lockedPendingJobs.values()]));
});

const wakeAfterRollback = syncAsync(function* (
  helpers: Helpers,
  txCtx: BaseTxContext,
  key: object,
  state: TxState,
  call: TxCall,
) {
  if (helpers.stateAdapter.getTransaction(txCtx) === undefined) {
    yield* wakeAfterTransactionRollback.steps(helpers, key, state);
    return;
  }
  const lockedPendingJobs = notificationsOf([call], "lockedPendingJobs");
  if (lockedPendingJobs.length === 0) return;
  helpers.stateAdapter.onTransactionCommit(txCtx, state.commit);
  helpers.stateAdapter.onTransactionRollback(txCtx, () =>
    runInMode(helpers, wakeAfterRollback, helpers, txCtx, key, state, call),
  );
  yield* step(
    helpers.notifyHelper.notifyJobsScheduled(lockedPendingJobs.map(({ typeName }) => typeName)),
  );
});

const rollBackCall = syncAsync(function* (
  helpers: Helpers,
  txCtx: BaseTxContext,
  key: object,
  state: TxState,
  call: TxCall,
) {
  state.calls.delete(call);
  const failure = runEffects(call.rollbacks.toReversed());
  yield* wakeAfterRollback.steps(helpers, txCtx, key, state, call);
  // oxlint-disable-next-line typescript/only-throw-error -- re-throwing a rollback effect's error
  if (failure) throw failure.error;
});

const isEmpty = ({ commits, rollbacks, notifications }: TxCall): boolean =>
  commits.length === 0 &&
  rollbacks.length === 0 &&
  notifications.every((added) =>
    Object.values(added).every((values) => (values?.length ?? 0) === 0),
  );

const createTxState = (helpers: Helpers, key: object): TxState => {
  const state: TxState = {
    calls: new Set(),
    lockedPendingJobs: new Map(),
    commit: () => runInMode(helpers, commitTransaction, helpers, key, state),
  };
  helpers.txEffects.set(key, state);
  return state;
};

const register = (helpers: Helpers, txCtx: BaseTxContext, key: object, call: TxCall): void => {
  const state = helpers.txEffects.get(key) ?? createTxState(helpers, key);
  state.calls.add(call);
  for (const { id, typeName } of notificationsOf([call], "lockedPendingJobs")) {
    state.lockedPendingJobs.set(id, typeName);
  }
  helpers.stateAdapter.onTransactionCommit(txCtx, state.commit);
  helpers.stateAdapter.onTransactionRollback(txCtx, () =>
    runInMode(helpers, rollBackCall, helpers, txCtx, key, state, call),
  );
};

export const createTxEffects = (): TxCall => {
  const call: TxCall = {
    commits: [],
    rollbacks: [],
    notifications: [],
    onCommit: (effect) => {
      call.commits.push(effect);
    },
    onRollback: (effect) => {
      call.rollbacks.push(effect);
    },
    notify: (notifications) => {
      call.notifications.push(notifications);
    },
  };
  return call;
};

export const registerTxEffects = (helpers: Helpers, txCtx: BaseTxContext, call: TxCall): void => {
  if (isEmpty(call)) return;
  const key = helpers.stateAdapter.getTransaction(txCtx);
  if (key === undefined) {
    throw new Error("Transaction effects require a context inside an open transaction");
  }
  register(helpers, txCtx, key, call);
};

export const registerTxEffectsAfterError = (
  helpers: Helpers,
  txCtx: BaseTxContext,
  call: TxCall,
): void => {
  if (isEmpty(call)) return;
  const key = helpers.stateAdapter.getTransaction(txCtx);
  if (key === undefined) return;
  register(helpers, txCtx, key, call);
};

export const notifyAfterTransaction = (
  helpers: Helpers,
  txCtx: BaseTxContext,
  notifications: Partial<TxNotifications>,
): void => {
  const effects = createTxEffects();
  effects.notify(notifications);
  registerTxEffects(helpers, txCtx, effects);
};
