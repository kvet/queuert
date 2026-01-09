import { RetryConfig, withRetry } from "../helpers/retry.js";
import { BaseStateAdapterContext, StateAdapter } from "./state-adapter.js";

export const wrapStateAdapterWithRetry = <TContext extends BaseStateAdapterContext, TJobId>({
  stateAdapter,
  retryConfig,
  isRetryableError,
}: {
  stateAdapter: StateAdapter<TContext, TJobId>;
  retryConfig: RetryConfig;
  isRetryableError: (error: unknown) => boolean;
}): StateAdapter<TContext, TJobId> => {
  const wrap = <T extends (...args: never[]) => Promise<unknown>>(fn: T): T =>
    (async (...args) => withRetry(async () => fn(...args), retryConfig, { isRetryableError })) as T;

  return {
    // Infrastructure methods - pass through without wrapping
    provideContext: stateAdapter.provideContext,
    runInTransaction: stateAdapter.runInTransaction,
    isInTransaction: stateAdapter.isInTransaction,

    // Operation methods - wrap with retry
    getJobSequenceById: wrap(stateAdapter.getJobSequenceById),
    getJobById: wrap(stateAdapter.getJobById),
    createJob: wrap(stateAdapter.createJob),
    addJobBlockers: wrap(stateAdapter.addJobBlockers),
    scheduleBlockedJobs: wrap(stateAdapter.scheduleBlockedJobs),
    getJobBlockers: wrap(stateAdapter.getJobBlockers),
    getNextJobAvailableInMs: wrap(stateAdapter.getNextJobAvailableInMs),
    acquireJob: wrap(stateAdapter.acquireJob),
    renewJobLease: wrap(stateAdapter.renewJobLease),
    rescheduleJob: wrap(stateAdapter.rescheduleJob),
    completeJob: wrap(stateAdapter.completeJob),
    removeExpiredJobLease: wrap(stateAdapter.removeExpiredJobLease),
    getExternalBlockers: wrap(stateAdapter.getExternalBlockers),
    deleteJobsByRootSequenceIds: wrap(stateAdapter.deleteJobsByRootSequenceIds),
    getJobForUpdate: wrap(stateAdapter.getJobForUpdate),
    getCurrentJobForUpdate: wrap(stateAdapter.getCurrentJobForUpdate),
  };
};
