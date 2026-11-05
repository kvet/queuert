import { type ObservabilityHelper } from "../observability-adapter/observability-helper.js";
import { type TransactionHooksMode } from "../transaction-hooks.js";
import { type BaseTxContext, type StateAdapter } from "./state-adapter.js";

export const wrapStateAdapterWithLogging = <
  TTxContext extends BaseTxContext,
  TJobId extends string,
  TWorkerId extends string,
  TTransactionHooksMode extends TransactionHooksMode,
>({
  stateAdapter,
  observabilityHelper,
}: {
  stateAdapter: StateAdapter<TTxContext, TJobId, TWorkerId, TTransactionHooksMode>;
  observabilityHelper: ObservabilityHelper;
}): StateAdapter<TTxContext, TJobId, TWorkerId, TTransactionHooksMode> => {
  const wrap = <T extends (...args: never[]) => Promise<unknown>>(
    operationName: keyof StateAdapter<any, any, any, any>,
    fn: T,
  ): T =>
    (async (...args) => {
      try {
        return await fn(...args);
      } catch (error) {
        observabilityHelper.stateAdapterError(operationName, error);
        throw error;
      }
    }) as T;

  return {
    // Infrastructure methods - pass through without wrapping
    config: stateAdapter.config,
    withTransaction: stateAdapter.withTransaction,
    isTransaction: stateAdapter.isTransaction,
    getTransactionHooks: stateAdapter.getTransactionHooks,

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
  };
};
