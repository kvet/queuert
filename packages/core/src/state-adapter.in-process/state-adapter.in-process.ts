import {
  type MaybePromise,
  type Mode,
  requireSync,
  tryCatch,
  tryFinally,
} from "@queuert/sync-async";

import type { StateAdapter } from "../state-adapter/state-adapter.ts";
import { withTxHooks } from "../tx-hooks/tx-hooks.ts";
import {
  type InProcessContext,
  type InProcessStateAdapterOptions,
  createInProcessState,
  requireTxHooks,
} from "./in-process-state.ts";

/**
 * In-process state adapter type, returned by {@link createInProcessStateAdapter}.
 *
 * @typeParam TMode - Whether the methods return promises or plain values; `"sync"` by default
 */
export type InProcessStateAdapter<TMode extends Mode = "sync"> = StateAdapter<
  InProcessContext,
  string,
  string,
  TMode
>;

/**
 * Create a state adapter that keeps chains, jobs and workers in memory. State is lost on process
 * exit and visible only inside this process.
 *
 * It is synchronous by default: every method returns its result directly, and `withTransaction`
 * requires a synchronous callback. With `mode: "async"` its methods return promises,
 * transactions run one at a time, and a call outside a transaction waits for the open one to
 * end.
 *
 * @param options - In-process state adapter configuration.
 */
export function createInProcessStateAdapter(
  options?: InProcessStateAdapterOptions & { mode?: "sync" },
): InProcessStateAdapter;
export function createInProcessStateAdapter(
  options: InProcessStateAdapterOptions & { mode: "async" },
): InProcessStateAdapter<"async">;
export function createInProcessStateAdapter(
  options: InProcessStateAdapterOptions & { mode: Mode },
): InProcessStateAdapter<Mode>;
export function createInProcessStateAdapter({
  mode = "sync",
  ...options
}: InProcessStateAdapterOptions & { mode?: Mode } = {}): InProcessStateAdapter<Mode> {
  const sync = mode === "sync";
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

  const locked =
    <TParams extends { txCtx?: InProcessContext }, TResult>(
      method: (params: TParams) => TResult,
    ): ((params: TParams) => Promise<TResult>) =>
    async (params) => {
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

    withTransaction: (fn: (txCtx: InProcessContext) => MaybePromise<unknown>) =>
      withTxHooks((txHooks) => {
        const transact = (): MaybePromise<unknown> => {
          const txCtx = beginTransaction(txHooks);
          return tryFinally(
            () =>
              tryCatch(
                () =>
                  sync
                    ? requireSync(
                        fn(txCtx),
                        "A sync StateAdapter.withTransaction requires a synchronous callback, but it returned a promise",
                      )
                    : fn(txCtx),
                (error) => {
                  rollbackTransaction(txCtx);
                  // oxlint-disable-next-line typescript/only-throw-error -- re-throwing caught error
                  throw error;
                },
              ),
            () => {
              endTransaction(txCtx);
            },
          );
        };
        if (sync) return transact();
        return (async () => {
          const waiting = acquire();
          if (waiting !== undefined) await waiting;
          try {
            return await transact();
          } finally {
            release();
          }
        })();
      }),

    isTransaction: methods.isTransaction,

    onTransactionCommit: (txCtx, callback) => {
      requireTxHooks(txCtx).onCommit(callback);
    },
    onTransactionRollback: (txCtx, callback) => {
      requireTxHooks(txCtx).onRollback(callback);
    },
    ...(sync
      ? { ...methods, sync: true, close, [Symbol.dispose]: close }
      : {
          getChains: locked(methods.getChains),
          getJobs: locked(methods.getJobs),
          getWorkers: locked(methods.getWorkers),
          createJobs: locked(methods.createJobs),
          continueJobs: locked(methods.continueJobs),
          completeJobs: locked(methods.completeJobs),
          rescheduleJobs: locked(methods.rescheduleJobs),
          deleteChains: locked(methods.deleteChains),
          startJobAttempts: locked(methods.startJobAttempts),
          getStartAttemptDelayMs: locked(methods.getStartAttemptDelayMs),
          addJobsBlockers: locked(methods.addJobsBlockers),
          getJobBlockers: locked(methods.getJobBlockers),
          unblockJobs: locked(methods.unblockJobs),
          startWorker: locked(methods.startWorker),
          extendWorkerLease: locked(methods.extendWorkerLease),
          stopWorker: locked(methods.stopWorker),
          getChainTypeNames: locked(methods.getChainTypeNames),
          getJobTypeNames: locked(methods.getJobTypeNames),
          countChainsByTypeName: locked(methods.countChainsByTypeName),
          countJobsByTypeName: locked(methods.countJobsByTypeName),
          countWorkers: locked(methods.countWorkers),
          countWorkersByTypeName: locked(methods.countWorkersByTypeName),
          countRunningJobsByWorkerId: locked(methods.countRunningJobsByWorkerId),
          listChains: locked(methods.listChains),
          listJobs: locked(methods.listJobs),
          listChainJobs: locked(methods.listChainJobs),
          listBlockedJobs: locked(methods.listBlockedJobs),
          listWorkers: locked(methods.listWorkers),
          listWorkerJobs: locked(methods.listWorkerJobs),
          close: closeExclusively,
          [Symbol.asyncDispose]: closeExclusively,
        }),
  } as InProcessStateAdapter<Mode>;
}
