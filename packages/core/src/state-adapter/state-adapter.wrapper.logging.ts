import { reportErrors } from "@queuert/helpers/report-errors";

import { isSyncAdapter } from "../adapter-mode.ts";
import type { ObservabilityHelper } from "../observability-adapter/observability-helper.ts";
import type { AnyStateAdapter } from "./state-adapter.ts";

export const wrapStateAdapterWithLogging = <TStateAdapter extends AnyStateAdapter>({
  stateAdapter,
  observabilityHelper,
}: {
  stateAdapter: TStateAdapter;
  observabilityHelper: ObservabilityHelper;
}): TStateAdapter => {
  // An async adapter's callers expect a promise, so a synchronous throw from it becomes a rejection.
  const rejectSyncThrows = !isSyncAdapter(stateAdapter);
  const wrap = <T extends (...args: never[]) => unknown>(
    operationName: Extract<keyof AnyStateAdapter, string>,
    fn: T,
  ): T =>
    reportErrors(
      fn,
      (error) => {
        observabilityHelper.stateAdapterError(operationName, error);
      },
      { rejectSyncThrows },
    );

  return {
    ...stateAdapter,

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
  };
};
