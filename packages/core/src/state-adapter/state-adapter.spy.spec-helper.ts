import { runOperation } from "@queuert/helpers";

import { type BaseTxContext, type StateAdapter, type StateAdapterMode } from "./state-adapter.js";

export type SpyCall = {
  name: string;
  children: SpyCall[];
  status?: "committed" | "rolled-back";
  result?: unknown;
};

export type SpyStateAdapter<
  TTxContext extends BaseTxContext,
  TJobId extends string,
  TMode extends StateAdapterMode = "async",
> = StateAdapter<TTxContext, TJobId, TMode> & {
  calls: SpyCall[];
  record: (args: { name: string } & TTxContext) => Promise<SpyCall>;
};

export const createSpyStateAdapter = <
  TTxContext extends BaseTxContext,
  TJobId extends string,
  TMode extends StateAdapterMode,
>(
  stateAdapter: StateAdapter<TTxContext, TJobId, TMode>,
): SpyStateAdapter<TTxContext, TJobId, TMode> => {
  const calls: SpyCall[] = [];
  const weakMap = new WeakMap<symbol, SpyCall>();

  const record = ({ txCtx, name }: { txCtx?: TTxContext; name: string }): SpyCall => {
    const call: SpyCall = { name, children: [] };
    const spyRef = (txCtx as TTxContext & { spyRef?: symbol })?.spyRef;
    if (spyRef && weakMap.has(spyRef)) {
      const parent = weakMap.get(spyRef)!;
      parent.children.push(call);
    } else {
      calls.push(call);
    }
    return call;
  };

  const wrap = <T extends (...args: never[]) => unknown>(name: string, fn: T): T =>
    ((...args: unknown[]) => {
      const params = args[0] as { txCtx?: TTxContext };
      const call = record({ txCtx: params?.txCtx, name });
      return runOperation(stateAdapter.mode, function* () {
        call.result = yield fn(...(args as Parameters<T>));
        return call.result;
      });
    }) as unknown as T;

  return {
    calls,

    config: stateAdapter.config,
    mode: stateAdapter.mode,
    withTransaction: ((fn: (txCtx: TTxContext) => unknown) => {
      const call = record({ txCtx: undefined, name: "withTransaction" });
      return runOperation(stateAdapter.mode, function* () {
        try {
          const result: unknown = yield stateAdapter.withTransaction((txCtx) => {
            const spyRef = Symbol("queuert.spy");
            weakMap.set(spyRef, call);
            return fn({ ...txCtx, spyRef }) as never;
          });
          call.status = "committed";
          return result;
        } catch (error) {
          call.status = "rolled-back";
          throw error;
        }
      });
    }) as StateAdapter<TTxContext, TJobId, TMode>["withTransaction"],
    isTransaction: (txCtx) => stateAdapter.isTransaction(txCtx),
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
    record: async ({ name, ...txCtx }: { name: string } & TTxContext) =>
      record({ name, txCtx: txCtx as unknown as TTxContext }),
  };
};
