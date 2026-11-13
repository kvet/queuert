import { andThen, tryCatch, type MaybePromise } from "@queuert/helpers/maybe-promise";

import type { ConformanceStateAdapter } from "../../conformance/adapters.ts";

export type SpyCall = {
  name: string;
  children: SpyCall[];
  status?: "committed" | "rolled-back";
  result?: unknown;
};

export type SpyStateAdapter<TStateAdapter extends ConformanceStateAdapter> = TStateAdapter & {
  calls: SpyCall[];
  record: (args: { name: string } & Record<string, unknown>) => SpyCall;
};

const spiedMethods = [
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

export const createSpyStateAdapter = <TStateAdapter extends ConformanceStateAdapter>(
  stateAdapter: TStateAdapter,
): SpyStateAdapter<TStateAdapter> => {
  const calls: SpyCall[] = [];
  const weakMap = new WeakMap<symbol, SpyCall>();

  const record = ({ txCtx, name }: { txCtx?: unknown; name: string }): SpyCall => {
    const call: SpyCall = { name, children: [] };
    const spyRef = (txCtx as { spyRef?: symbol } | undefined)?.spyRef;
    if (spyRef && weakMap.has(spyRef)) {
      const parent = weakMap.get(spyRef)!;
      parent.children.push(call);
    } else {
      calls.push(call);
    }
    return call;
  };

  const wrap =
    (name: string, fn: (...args: unknown[]) => MaybePromise<unknown>) =>
    (...args: unknown[]) => {
      const params = args[0] as { txCtx?: unknown } | undefined;
      const call = record({ txCtx: params?.txCtx, name });
      return andThen(fn(...args), (result) => {
        call.result = result;
        return result;
      });
    };

  const spied: Record<string, unknown> = {};
  for (const name of spiedMethods) {
    spied[name] = wrap(name, stateAdapter[name] as (...args: unknown[]) => MaybePromise<unknown>);
  }

  return {
    ...stateAdapter,
    ...spied,
    calls,
    withTransaction: <T>(fn: (txCtx: any) => MaybePromise<T>): MaybePromise<T> => {
      const call = record({ txCtx: undefined, name: "withTransaction" });
      return tryCatch(
        () =>
          andThen(
            stateAdapter.withTransaction((txCtx: Record<string, unknown>) => {
              const spyRef = Symbol();
              weakMap.set(spyRef, call);
              return fn({ ...txCtx, spyRef });
            }),
            (result) => {
              call.status = "committed";
              return result;
            },
          ),
        (error) => {
          call.status = "rolled-back";
          // oxlint-disable-next-line typescript/only-throw-error -- re-throwing caught error
          throw error;
        },
      );
    },
    record: ({ name, ...txCtx }: { name: string } & Record<string, unknown>) =>
      record({ name, txCtx }),
  } as unknown as SpyStateAdapter<TStateAdapter>;
};
