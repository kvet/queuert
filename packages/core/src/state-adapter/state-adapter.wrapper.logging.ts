import { isThenable } from "@queuert/helpers";

import { type ObservabilityHelper } from "../observability-adapter/observability-helper.js";
import { type BaseTxContext, type StateAdapter, type StateAdapterMode } from "./state-adapter.js";

export const wrapStateAdapterWithLogging = <
  TTxContext extends BaseTxContext,
  TJobId extends string,
  TMode extends StateAdapterMode,
>({
  stateAdapter,
  observabilityHelper,
}: {
  stateAdapter: StateAdapter<TTxContext, TJobId, TMode>;
  observabilityHelper: ObservabilityHelper;
}): StateAdapter<TTxContext, TJobId, TMode> => {
  const wrap = <T extends (...args: never[]) => unknown>(
    operationName: keyof StateAdapter<any, any, any>,
    fn: T,
  ): T =>
    ((...args) => {
      const report = (error: unknown): never => {
        observabilityHelper.stateAdapterError(operationName, error);
        // oxlint-disable-next-line typescript/only-throw-error -- re-throwing caught error
        throw error;
      };
      let result: unknown;
      try {
        result = fn(...args);
      } catch (error) {
        return report(error);
      }
      return isThenable(result) ? Promise.resolve(result).catch(report) : result;
    }) as T;

  return {
    // Infrastructure methods - pass through without wrapping
    config: stateAdapter.config,
    mode: stateAdapter.mode,
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
    extendJobAttempt: wrap("extendJobAttempt", stateAdapter.extendJobAttempt),
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
