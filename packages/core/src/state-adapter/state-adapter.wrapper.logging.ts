import { ObservabilityHelper } from "../observability-adapter/observability-helper.js";
import { BaseStateAdapterContext, StateAdapter } from "./state-adapter.js";

export const wrapStateAdapterWithLogging = <
  TTxContext extends BaseStateAdapterContext,
  TContext extends BaseStateAdapterContext,
  TJobId extends string,
>({
  stateAdapter,
  observabilityHelper,
}: {
  stateAdapter: StateAdapter<TTxContext, TContext, TJobId>;
  observabilityHelper: ObservabilityHelper;
}): StateAdapter<TTxContext, TContext, TJobId> => {
  const wrap = <T extends (...args: never[]) => Promise<unknown>>(
    operationName: keyof StateAdapter<any, any, any>,
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
    provideContext: stateAdapter.provideContext,
    runInTransaction: stateAdapter.runInTransaction,
    isInTransaction: stateAdapter.isInTransaction,

    // Operation methods - wrap with error logging
    getJobSequenceById: wrap("getJobSequenceById", stateAdapter.getJobSequenceById),
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
    deleteJobsByRootSequenceIds: wrap(
      "deleteJobsByRootSequenceIds",
      stateAdapter.deleteJobsByRootSequenceIds,
    ),
    getJobForUpdate: wrap("getJobForUpdate", stateAdapter.getJobForUpdate),
    getCurrentJobForUpdate: wrap("getCurrentJobForUpdate", stateAdapter.getCurrentJobForUpdate),
  };
};
