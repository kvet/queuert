import { type ObservabilityHelper } from "../observability-adapter/observability-helper.js";
import { type BaseTxContext, type StateAdapter } from "./state-adapter.js";

export const wrapStateAdapterWithLogging = <
  TTxContext extends BaseTxContext,
  TJobId extends string,
>({
  stateAdapter,
  observabilityHelper,
}: {
  stateAdapter: StateAdapter<TTxContext, TJobId>;
  observabilityHelper: ObservabilityHelper;
}): StateAdapter<TTxContext, TJobId> => {
  const wrap = <T extends (...args: never[]) => Promise<unknown>>(
    operationName: keyof StateAdapter<any, any>,
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

    // Operation methods - wrap with error logging
    getChains: wrap("getChains", stateAdapter.getChains),
    getJobs: wrap("getJobs", stateAdapter.getJobs),
    createJobs: wrap("createJobs", stateAdapter.createJobs),
    continueJobs: wrap("continueJobs", stateAdapter.continueJobs),
    completeJobs: wrap("completeJobs", stateAdapter.completeJobs),
    rescheduleJobs: wrap("rescheduleJobs", stateAdapter.rescheduleJobs),
    deleteChains: wrap("deleteChains", stateAdapter.deleteChains),
    startJobAttempts: wrap("startJobAttempts", stateAdapter.startJobAttempts),
    getStartAttemptDelayMs: wrap("getStartAttemptDelayMs", stateAdapter.getStartAttemptDelayMs),
    startWorker: wrap("startWorker", stateAdapter.startWorker),
    extendWorkerLease: wrap("extendWorkerLease", stateAdapter.extendWorkerLease),
    stopWorker: wrap("stopWorker", stateAdapter.stopWorker),
    getWorkers: wrap("getWorkers", stateAdapter.getWorkers),
    listWorkers: wrap("listWorkers", stateAdapter.listWorkers),
    countWorkersByTypeNames: wrap("countWorkersByTypeNames", stateAdapter.countWorkersByTypeNames),
    listWorkerJobs: wrap("listWorkerJobs", stateAdapter.listWorkerJobs),
    reclaimExpiredJobAttempts: wrap(
      "reclaimExpiredJobAttempts",
      stateAdapter.reclaimExpiredJobAttempts,
    ),
    addJobsBlockers: wrap("addJobsBlockers", stateAdapter.addJobsBlockers),
    getJobBlockers: wrap("getJobBlockers", stateAdapter.getJobBlockers),
    unblockJobs: wrap("unblockJobs", stateAdapter.unblockJobs),
    listChainTypeNames: wrap("listChainTypeNames", stateAdapter.listChainTypeNames),
    listJobTypeNames: wrap("listJobTypeNames", stateAdapter.listJobTypeNames),
    countByChainTypeNames: wrap("countByChainTypeNames", stateAdapter.countByChainTypeNames),
    countByJobTypeNames: wrap("countByJobTypeNames", stateAdapter.countByJobTypeNames),
    listChains: wrap("listChains", stateAdapter.listChains),
    listJobs: wrap("listJobs", stateAdapter.listJobs),
    listChainJobs: wrap("listChainJobs", stateAdapter.listChainJobs),
    listBlockedJobs: wrap("listBlockedJobs", stateAdapter.listBlockedJobs),

    close: stateAdapter.close,
  };
};
