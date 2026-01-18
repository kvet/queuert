import { RetryConfig, withRetry } from "../helpers/retry.js";
import { BaseTxContext, StateAdapter } from "./state-adapter.js";

export const wrapStateAdapterWithRetry = <TTxContext extends BaseTxContext, TJobId extends string>({
  stateAdapter,
  retryConfig,
  isRetryableError,
}: {
  stateAdapter: StateAdapter<TTxContext, TJobId>;
  retryConfig: RetryConfig;
  isRetryableError: (error: unknown) => boolean;
}): StateAdapter<TTxContext, TJobId> => {
  const wrap = <T extends (...args: never[]) => Promise<unknown>>(fn: T): T =>
    (async (...args) => withRetry(async () => fn(...args), retryConfig, { isRetryableError })) as T;

  return {
    // Infrastructure methods - pass through without wrapping
    runInTransaction: stateAdapter.runInTransaction,

    // Operation methods - wrap with retry
    getJobChainById: wrap(stateAdapter.getJobChainById),
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
    deleteJobsByRootChainIds: wrap(stateAdapter.deleteJobsByRootChainIds),
    getJobForUpdate: wrap(stateAdapter.getJobForUpdate),
    getCurrentJobForUpdate: wrap(stateAdapter.getCurrentJobForUpdate),
  };
};
