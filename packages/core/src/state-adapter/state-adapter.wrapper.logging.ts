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
    scheduleBlockedJobs: wrap("scheduleBlockedJobs", stateAdapter.scheduleBlockedJobs),
    getJobBlockers: wrap("getJobBlockers", stateAdapter.getJobBlockers),
    getNextJobAvailableInMs: wrap("getNextJobAvailableInMs", stateAdapter.getNextJobAvailableInMs),
    acquireJob: wrap("acquireJob", stateAdapter.acquireJob),
    renewJobLease: wrap("renewJobLease", stateAdapter.renewJobLease),
    rescheduleJob: wrap("rescheduleJob", stateAdapter.rescheduleJob),
    completeJob: wrap("completeJob", stateAdapter.completeJob),
    removeExpiredJobLease: wrap("removeExpiredJobLease", stateAdapter.removeExpiredJobLease),
    getExternalBlockers: wrap("getExternalBlockers", stateAdapter.getExternalBlockers),
    deleteJobsByRootChainIds: wrap(
      "deleteJobsByRootChainIds",
      stateAdapter.deleteJobsByRootChainIds,
    ),
    getJobForUpdate: wrap("getJobForUpdate", stateAdapter.getJobForUpdate),
    getCurrentJobForUpdate: wrap("getCurrentJobForUpdate", stateAdapter.getCurrentJobForUpdate),
    listChains: wrap("listChains", stateAdapter.listChains),
    listJobs: wrap("listJobs", stateAdapter.listJobs),
    getJobsBlockedByChain: wrap("getJobsBlockedByChain", stateAdapter.getJobsBlockedByChain),
  };
};
