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
    transactionConcurrency: stateAdapter.transactionConcurrency,
    withTransaction: stateAdapter.withTransaction,
    withSavepoint: stateAdapter.withSavepoint,

    // Operation methods - wrap with error logging
    getChains: wrap("getChains", stateAdapter.getChains),
    getJobs: wrap("getJobs", stateAdapter.getJobs),
    createChains: wrap("createChains", stateAdapter.createChains),
    createContinuationJob: wrap("createContinuationJob", stateAdapter.createContinuationJob),
    addJobsBlockers: wrap("addJobsBlockers", stateAdapter.addJobsBlockers),
    getJobBlockers: wrap("getJobBlockers", stateAdapter.getJobBlockers),
    unblockJobs: wrap("unblockJobs", stateAdapter.unblockJobs),
    startJobAttempt: wrap("startJobAttempt", stateAdapter.startJobAttempt),
    extendJobAttempt: wrap("extendJobAttempt", stateAdapter.extendJobAttempt),
    finishJobAttempt: wrap("finishJobAttempt", stateAdapter.finishJobAttempt),
    reclaimExpiredJobAttempt: wrap(
      "reclaimExpiredJobAttempt",
      stateAdapter.reclaimExpiredJobAttempt,
    ),
    getStartAttemptDelayMs: wrap("getStartAttemptDelayMs", stateAdapter.getStartAttemptDelayMs),
    rescheduleJobs: wrap("rescheduleJobs", stateAdapter.rescheduleJobs),
    deleteChains: wrap("deleteChains", stateAdapter.deleteChains),
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
