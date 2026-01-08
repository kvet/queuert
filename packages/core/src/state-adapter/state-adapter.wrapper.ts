import { wrapOperation } from "../helpers/wrap-operation.js";
import { LogHelper } from "../log-helper.js";
import { BaseStateAdapterContext, StateAdapter } from "./state-adapter.js";

type OperationKeys<TContext extends BaseStateAdapterContext, TJobId> = Exclude<
  keyof StateAdapter<TContext, TJobId>,
  "provideContext" | "runInTransaction" | "isInTransaction"
>;

export const wrapStateAdapter = <TContext extends BaseStateAdapterContext, TJobId>({
  stateAdapter,
  logHelper,
}: {
  stateAdapter: StateAdapter<TContext, TJobId>;
  logHelper: LogHelper;
}): StateAdapter<TContext, TJobId> => {
  const wrap = <TKey extends OperationKeys<TContext, TJobId>>(
    operation: TKey,
  ): StateAdapter<TContext, TJobId>[TKey] =>
    wrapOperation(stateAdapter, operation, (op, error) => {
      logHelper.stateAdapterError(op as string, error);
    });

  return {
    // Infrastructure methods - pass through without wrapping
    provideContext: stateAdapter.provideContext.bind(stateAdapter),
    runInTransaction: stateAdapter.runInTransaction.bind(stateAdapter),
    isInTransaction: stateAdapter.isInTransaction.bind(stateAdapter),

    // Operation methods - wrap with error logging
    getJobSequenceById: wrap("getJobSequenceById"),
    getJobById: wrap("getJobById"),
    createJob: wrap("createJob"),
    addJobBlockers: wrap("addJobBlockers"),
    scheduleBlockedJobs: wrap("scheduleBlockedJobs"),
    getJobBlockers: wrap("getJobBlockers"),
    getNextJobAvailableInMs: wrap("getNextJobAvailableInMs"),
    acquireJob: wrap("acquireJob"),
    renewJobLease: wrap("renewJobLease"),
    rescheduleJob: wrap("rescheduleJob"),
    completeJob: wrap("completeJob"),
    removeExpiredJobLease: wrap("removeExpiredJobLease"),
    getExternalBlockers: wrap("getExternalBlockers"),
    deleteJobsByRootSequenceIds: wrap("deleteJobsByRootSequenceIds"),
    getJobForUpdate: wrap("getJobForUpdate"),
    getCurrentJobForUpdate: wrap("getCurrentJobForUpdate"),
  };
};
