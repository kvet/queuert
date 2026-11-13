import { requireSync } from "@queuert/helpers/maybe-promise";

import type { StateAdapter, SyncStateAdapter } from "../state-adapter/state-adapter.ts";
import { withTxHooks } from "../tx-hooks/tx-hooks.ts";
import {
  type InProcessContext,
  type InProcessStateAdapterOptions,
  createInProcessState,
  requireTxHooks,
} from "./in-process-state.ts";

/** In-process state adapter type, returned by {@link createInProcessStateAdapter}. */
export type InProcessStateAdapter = StateAdapter<InProcessContext, string, string>;

/** Synchronous in-process state adapter type, returned by {@link createSyncInProcessStateAdapter}. */
export type SyncInProcessStateAdapter = SyncStateAdapter<InProcessContext, string, string>;

/**
 * Create a state adapter that keeps chains, jobs and workers in memory. State is lost on process
 * exit and visible only inside this process. Transactions run one at a time, and a call outside a
 * transaction waits for the open one to end.
 *
 * @param options - In-process state adapter configuration.
 */
export const createInProcessStateAdapter = (
  options: InProcessStateAdapterOptions = {},
): InProcessStateAdapter => {
  const { methods, beginTransaction, rollbackTransaction, endTransaction, close } =
    createInProcessState(options);
  let held = false;
  const waiters: (() => void)[] = [];

  const acquire = (): Promise<void> | undefined => {
    if (!held) {
      held = true;
      return undefined;
    }
    return new Promise<void>((resolve) => {
      waiters.push(resolve);
    });
  };
  const release = (): void => {
    const next = waiters.shift();
    if (next === undefined) held = false;
    else next();
  };

  const guarded =
    <TParams extends { txCtx?: InProcessContext }, TResult>(method: (params: TParams) => TResult) =>
    async (params: TParams): Promise<TResult> => {
      if (!held || (params.txCtx !== undefined && methods.isTransaction(params.txCtx))) {
        return method(params);
      }
      await acquire();
      try {
        return method(params);
      } finally {
        release();
      }
    };
  const closeExclusively = async (): Promise<void> => {
    await acquire();
    try {
      close();
    } finally {
      release();
    }
  };

  return {
    config: methods.config,

    withTransaction: async (fn) =>
      withTxHooks(async (txHooks) => {
        const waiting = acquire();
        if (waiting !== undefined) await waiting;
        try {
          const txCtx = beginTransaction(txHooks);
          try {
            return await fn(txCtx);
          } catch (error) {
            rollbackTransaction(txCtx);
            throw error;
          } finally {
            endTransaction(txCtx);
          }
        } finally {
          release();
        }
      }),

    isTransaction: methods.isTransaction,

    onTransactionCommit: (txCtx, callback) => {
      requireTxHooks(txCtx).onCommit(callback);
    },
    onTransactionRollback: (txCtx, callback) => {
      requireTxHooks(txCtx).onRollback(callback);
    },
    getChains: guarded(methods.getChains),
    getJobs: guarded(methods.getJobs),
    getWorkers: guarded(methods.getWorkers),
    createJobs: guarded(methods.createJobs),
    continueJobs: guarded(methods.continueJobs),
    completeJobs: guarded(methods.completeJobs),
    rescheduleJobs: guarded(methods.rescheduleJobs),
    deleteChains: guarded(methods.deleteChains),
    startJobAttempts: guarded(methods.startJobAttempts),
    getStartAttemptDelayMs: guarded(methods.getStartAttemptDelayMs),
    addJobsBlockers: guarded(methods.addJobsBlockers),
    getJobBlockers: guarded(methods.getJobBlockers),
    unblockJobs: guarded(methods.unblockJobs),
    startWorker: guarded(methods.startWorker),
    extendWorkerLease: guarded(methods.extendWorkerLease),
    stopWorker: guarded(methods.stopWorker),
    getChainTypeNames: guarded(methods.getChainTypeNames),
    getJobTypeNames: guarded(methods.getJobTypeNames),
    countChainsByTypeName: guarded(methods.countChainsByTypeName),
    countJobsByTypeName: guarded(methods.countJobsByTypeName),
    countWorkers: guarded(methods.countWorkers),
    countWorkersByTypeName: guarded(methods.countWorkersByTypeName),
    countRunningJobsByWorkerId: guarded(methods.countRunningJobsByWorkerId),
    listChains: guarded(methods.listChains),
    listJobs: guarded(methods.listJobs),
    listChainJobs: guarded(methods.listChainJobs),
    listBlockedJobs: guarded(methods.listBlockedJobs),
    listWorkers: guarded(methods.listWorkers),
    listWorkerJobs: guarded(methods.listWorkerJobs),

    close: closeExclusively,

    [Symbol.asyncDispose]: closeExclusively,
  };
};

/**
 * Synchronous variant of {@link createInProcessStateAdapter}: every method returns its result
 * directly, and `withTransaction` requires a synchronous callback.
 *
 * @param options - In-process state adapter configuration.
 */
export const createSyncInProcessStateAdapter = (
  options: InProcessStateAdapterOptions = {},
): SyncInProcessStateAdapter => {
  const { methods, beginTransaction, rollbackTransaction, endTransaction, close } =
    createInProcessState(options);

  return {
    sync: true,
    config: methods.config,

    withTransaction: (fn) =>
      withTxHooks((txHooks) => {
        const txCtx = beginTransaction(txHooks);
        try {
          return requireSync(
            fn(txCtx),
            "SyncStateAdapter.withTransaction requires a synchronous callback, but it returned a promise",
          );
        } catch (error) {
          rollbackTransaction(txCtx);
          throw error;
        } finally {
          endTransaction(txCtx);
        }
      }),

    isTransaction: methods.isTransaction,

    onTransactionCommit: (txCtx, callback) => {
      requireTxHooks(txCtx).onCommit(callback);
    },
    onTransactionRollback: (txCtx, callback) => {
      requireTxHooks(txCtx).onRollback(callback);
    },
    getChains: methods.getChains,
    getJobs: methods.getJobs,
    getWorkers: methods.getWorkers,
    createJobs: methods.createJobs,
    continueJobs: methods.continueJobs,
    completeJobs: methods.completeJobs,
    rescheduleJobs: methods.rescheduleJobs,
    deleteChains: methods.deleteChains,
    startJobAttempts: methods.startJobAttempts,
    getStartAttemptDelayMs: methods.getStartAttemptDelayMs,
    addJobsBlockers: methods.addJobsBlockers,
    getJobBlockers: methods.getJobBlockers,
    unblockJobs: methods.unblockJobs,
    startWorker: methods.startWorker,
    extendWorkerLease: methods.extendWorkerLease,
    stopWorker: methods.stopWorker,
    getChainTypeNames: methods.getChainTypeNames,
    getJobTypeNames: methods.getJobTypeNames,
    countChainsByTypeName: methods.countChainsByTypeName,
    countJobsByTypeName: methods.countJobsByTypeName,
    countWorkers: methods.countWorkers,
    countWorkersByTypeName: methods.countWorkersByTypeName,
    countRunningJobsByWorkerId: methods.countRunningJobsByWorkerId,
    listChains: methods.listChains,
    listJobs: methods.listJobs,
    listChainJobs: methods.listChainJobs,
    listBlockedJobs: methods.listBlockedJobs,
    listWorkers: methods.listWorkers,
    listWorkerJobs: methods.listWorkerJobs,

    close,
    [Symbol.dispose]: close,
  };
};
