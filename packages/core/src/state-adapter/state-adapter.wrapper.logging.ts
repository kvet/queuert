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
    runInTransaction: stateAdapter.runInTransaction,

    // Operation methods - wrap with error logging
    getJobChainById: wrap("getJobChainById", stateAdapter.getJobChainById),
    getJobById: wrap("getJobById", stateAdapter.getJobById),
    createJob: wrap("createJob", stateAdapter.createJob),
    addJobBlockers: wrap("addJobBlockers", stateAdapter.addJobBlockers),
    unblockJobs: wrap("unblockJobs", stateAdapter.unblockJobs),
    getJobBlockers: wrap("getJobBlockers", stateAdapter.getJobBlockers),
    getNextJobAvailableInMs: wrap("getNextJobAvailableInMs", stateAdapter.getNextJobAvailableInMs),
    acquireJob: wrap("acquireJob", stateAdapter.acquireJob),
    renewJobLease: wrap("renewJobLease", stateAdapter.renewJobLease),
    rescheduleJob: wrap("rescheduleJob", stateAdapter.rescheduleJob),
    completeJob: wrap("completeJob", stateAdapter.completeJob),
    reapExpiredJobLease: wrap("reapExpiredJobLease", stateAdapter.reapExpiredJobLease),
    deleteJobChains: wrap("deleteJobChains", stateAdapter.deleteJobChains),
    getJobForUpdate: wrap("getJobForUpdate", stateAdapter.getJobForUpdate),
    getLatestChainJobForUpdate: wrap(
      "getLatestChainJobForUpdate",
      stateAdapter.getLatestChainJobForUpdate,
    ),
    listJobChains: wrap("listJobChains", stateAdapter.listJobChains),
    listJobs: wrap("listJobs", stateAdapter.listJobs),
    listJobChainJobs: wrap("listJobChainJobs", stateAdapter.listJobChainJobs),
    listBlockedJobs: wrap("listBlockedJobs", stateAdapter.listBlockedJobs),
  };
};
