import type { MaybePromise } from "@queuert/helpers/maybe-promise";

import { isSyncAdapter } from "../../adapter-mode.ts";
import type { ConformanceStateAdapter } from "../../conformance/adapters.ts";
import { createFlakyBatchGenerator } from "./flaky-batch-generator.ts";
import type { FlakyCallCounts } from "./flaky-notify-adapter.ts";

const flakyMethods = [
  "getChains",
  "getJobs",
  "getWorkers",
  "createJobs",
  "continueJobs",
  "completeJobs",
  "rescheduleJobs",
  "deleteChains",
  "startJobAttempts",
  "getStartAttemptDelayMs",
  "addJobsBlockers",
  "getJobBlockers",
  "unblockJobs",
  "startWorker",
  "extendWorkerLease",
  "stopWorker",
  "getChainTypeNames",
  "getJobTypeNames",
  "countChainsByTypeName",
  "countJobsByTypeName",
  "countWorkers",
  "countWorkersByTypeName",
  "countRunningJobsByWorkerId",
  "listChains",
  "listJobs",
  "listChainJobs",
  "listBlockedJobs",
  "listWorkers",
  "listWorkerJobs",
] as const;

export const createFlakyStateAdapter = <TStateAdapter extends ConformanceStateAdapter>(
  stateAdapter: TStateAdapter,
): { stateAdapter: TStateAdapter; counts: FlakyCallCounts } => {
  const counts: FlakyCallCounts = { calls: 0, errors: 0 };
  const shouldError = createFlakyBatchGenerator();
  const sync = isSyncAdapter(stateAdapter);

  const flakyError = (): Error | undefined => {
    counts.calls++;
    if (!shouldError()) return undefined;
    counts.errors++;
    const error = new Error("connection reset") as Error & { code: string };
    error.code = "ECONNRESET";
    return error;
  };

  const fail = (error: Error): never | Promise<never> => {
    if (sync) throw error;
    return Promise.reject(error);
  };

  const wrap =
    (fn: (...args: unknown[]) => MaybePromise<unknown>) =>
    (...args: unknown[]) => {
      const params = args[0] as { txCtx?: unknown } | undefined;
      const error = params?.txCtx === undefined ? flakyError() : undefined;
      return error === undefined ? fn(...args) : fail(error);
    };

  const flaky: Record<string, unknown> = {};
  for (const name of flakyMethods) {
    flaky[name] = wrap(stateAdapter[name] as (...args: unknown[]) => MaybePromise<unknown>);
  }

  return {
    counts,
    stateAdapter: {
      ...stateAdapter,
      ...flaky,
      withTransaction: <T>(fn: (txCtx: any) => MaybePromise<T>): MaybePromise<T> => {
        const error = flakyError();
        return error === undefined ? stateAdapter.withTransaction(fn) : fail(error);
      },
    },
  };
};
