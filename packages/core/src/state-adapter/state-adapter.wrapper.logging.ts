import type { ObservabilityHelper } from "../observability-adapter/observability-helper.ts";
import type { BaseTxContext, StateAdapter } from "./state-adapter.ts";

export const wrapStateAdapterWithLogging = <
  TTxContext extends BaseTxContext,
  TJobId extends string,
  TWorkerId extends string,
>({
  stateAdapter,
  observabilityHelper,
}: {
  stateAdapter: StateAdapter<TTxContext, TJobId, TWorkerId>;
  observabilityHelper: ObservabilityHelper;
}): StateAdapter<TTxContext, TJobId, TWorkerId> => {
  const wrap = <T extends (...args: never[]) => Promise<unknown>>(
    operationName: keyof StateAdapter<any, any, any>,
    fn: T,
  ): T => {
    const onError = (error: unknown): never => {
      observabilityHelper.stateAdapterError(operationName, error);
      throw error;
    };
    // oxlint-disable-next-line typescript/promise-function-async -- an async wrapper would add a promise per adapter call
    return ((...args) => {
      try {
        return fn(...args).catch(onError);
      } catch (error) {
        // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- re-rejecting a caught error
        return Promise.reject(error).catch(onError);
      }
    }) as T;
  };

  return {
    // Infrastructure methods - pass through without wrapping
    config: stateAdapter.config,
    withTransaction: stateAdapter.withTransaction,
    isTransaction: stateAdapter.isTransaction,
    onTransactionCommit: stateAdapter.onTransactionCommit,
    onTransactionRollback: stateAdapter.onTransactionRollback,

    // Operation methods - wrap with error logging
    getChains: wrap("getChains", stateAdapter.getChains),
    getJobs: wrap("getJobs", stateAdapter.getJobs),
    getWorkers: wrap("getWorkers", stateAdapter.getWorkers),
    createJobs: wrap("createJobs", stateAdapter.createJobs),
    continueJobs: wrap("continueJobs", stateAdapter.continueJobs),
    completeJobs: wrap("completeJobs", stateAdapter.completeJobs),
    rescheduleJobs: wrap("rescheduleJobs", stateAdapter.rescheduleJobs),
    deleteChains: wrap("deleteChains", stateAdapter.deleteChains),
    startJobAttempts: wrap("startJobAttempts", stateAdapter.startJobAttempts),
    getStartAttemptDelayMs: wrap("getStartAttemptDelayMs", stateAdapter.getStartAttemptDelayMs),
    addJobsBlockers: wrap("addJobsBlockers", stateAdapter.addJobsBlockers),
    getJobBlockers: wrap("getJobBlockers", stateAdapter.getJobBlockers),
    unblockJobs: wrap("unblockJobs", stateAdapter.unblockJobs),
    startWorker: wrap("startWorker", stateAdapter.startWorker),
    extendWorkerLease: wrap("extendWorkerLease", stateAdapter.extendWorkerLease),
    stopWorker: wrap("stopWorker", stateAdapter.stopWorker),
    getChainTypeNames: wrap("getChainTypeNames", stateAdapter.getChainTypeNames),
    getJobTypeNames: wrap("getJobTypeNames", stateAdapter.getJobTypeNames),
    countChainsByTypeName: wrap("countChainsByTypeName", stateAdapter.countChainsByTypeName),
    countJobsByTypeName: wrap("countJobsByTypeName", stateAdapter.countJobsByTypeName),
    countWorkers: wrap("countWorkers", stateAdapter.countWorkers),
    countWorkersByTypeName: wrap("countWorkersByTypeName", stateAdapter.countWorkersByTypeName),
    countRunningJobsByWorkerId: wrap(
      "countRunningJobsByWorkerId",
      stateAdapter.countRunningJobsByWorkerId,
    ),
    listChains: wrap("listChains", stateAdapter.listChains),
    listJobs: wrap("listJobs", stateAdapter.listJobs),
    listChainJobs: wrap("listChainJobs", stateAdapter.listChainJobs),
    listBlockedJobs: wrap("listBlockedJobs", stateAdapter.listBlockedJobs),
    listWorkers: wrap("listWorkers", stateAdapter.listWorkers),
    listWorkerJobs: wrap("listWorkerJobs", stateAdapter.listWorkerJobs),

    close: stateAdapter.close,
    [Symbol.asyncDispose]: stateAdapter.close,
  };
};
