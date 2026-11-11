import type { BaseTxContext, StateAdapter } from "../../state-adapter/state-adapter.ts";
import { createFlakyBatchGenerator } from "./flaky-batch-generator.ts";
import type { FlakyCallCounts } from "./flaky-notify-adapter.ts";

export const createFlakyStateAdapter = <
  TTxContext extends BaseTxContext,
  TJobId extends string,
  TWorkerId extends string,
>(
  stateAdapter: StateAdapter<TTxContext, TJobId, TWorkerId>,
): { stateAdapter: StateAdapter<TTxContext, TJobId, TWorkerId>; counts: FlakyCallCounts } => {
  const counts: FlakyCallCounts = { calls: 0, errors: 0 };
  const shouldError = createFlakyBatchGenerator();

  const maybeThrow = (): void => {
    counts.calls++;
    if (shouldError()) {
      counts.errors++;
      const error = new Error("connection reset") as Error & { code: string };
      error.code = "ECONNRESET";
      throw error;
    }
  };

  const wrap = <T extends (...args: never[]) => Promise<unknown>>(fn: T): T =>
    (async (...args: Parameters<T>) => {
      const params = args[0] as { txCtx?: TTxContext } | undefined;
      if (params?.txCtx === undefined) {
        maybeThrow();
      }
      return fn(...args);
    }) as unknown as T;

  return {
    counts,
    stateAdapter: {
      config: stateAdapter.config,
      withTransaction: async (fn) => {
        maybeThrow();
        return stateAdapter.withTransaction(fn);
      },
      isTransaction: (txCtx) => stateAdapter.isTransaction(txCtx),
      getChains: wrap(stateAdapter.getChains),
      getJobs: wrap(stateAdapter.getJobs),
      getWorkers: wrap(stateAdapter.getWorkers),
      createJobs: wrap(stateAdapter.createJobs),
      continueJobs: wrap(stateAdapter.continueJobs),
      completeJobs: wrap(stateAdapter.completeJobs),
      rescheduleJobs: wrap(stateAdapter.rescheduleJobs),
      deleteChains: wrap(stateAdapter.deleteChains),
      startJobAttempts: wrap(stateAdapter.startJobAttempts),
      getStartAttemptDelayMs: wrap(stateAdapter.getStartAttemptDelayMs),
      addJobsBlockers: wrap(stateAdapter.addJobsBlockers),
      getJobBlockers: wrap(stateAdapter.getJobBlockers),
      unblockJobs: wrap(stateAdapter.unblockJobs),
      startWorker: wrap(stateAdapter.startWorker),
      extendWorkerLease: wrap(stateAdapter.extendWorkerLease),
      stopWorker: wrap(stateAdapter.stopWorker),
      getChainTypeNames: wrap(stateAdapter.getChainTypeNames),
      getJobTypeNames: wrap(stateAdapter.getJobTypeNames),
      countChainsByTypeName: wrap(stateAdapter.countChainsByTypeName),
      countJobsByTypeName: wrap(stateAdapter.countJobsByTypeName),
      countWorkers: wrap(stateAdapter.countWorkers),
      countWorkersByTypeName: wrap(stateAdapter.countWorkersByTypeName),
      countRunningJobsByWorkerId: wrap(stateAdapter.countRunningJobsByWorkerId),
      listChains: wrap(stateAdapter.listChains),
      listJobs: wrap(stateAdapter.listJobs),
      listChainJobs: wrap(stateAdapter.listChainJobs),
      listBlockedJobs: wrap(stateAdapter.listBlockedJobs),
      listWorkers: wrap(stateAdapter.listWorkers),
      listWorkerJobs: wrap(stateAdapter.listWorkerJobs),
      close: stateAdapter.close,
      [Symbol.asyncDispose]: stateAdapter.close,
    },
  };
};
