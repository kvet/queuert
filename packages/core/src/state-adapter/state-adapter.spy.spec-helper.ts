import { type BaseTxContext, type StateAdapter } from "./state-adapter.js";

export type SpyCall = {
  name: string;
  children: SpyCall[];
  status?: "committed" | "rolled-back";
  result?: unknown;
};

export type SpyStateAdapter<TTxContext extends BaseTxContext, TJobId extends string> = StateAdapter<
  TTxContext,
  TJobId
> & {
  calls: SpyCall[];
  record: (args: { name: string } & TTxContext) => Promise<SpyCall>;
};

export const createSpyStateAdapter = <TTxContext extends BaseTxContext, TJobId extends string>(
  stateAdapter: StateAdapter<TTxContext, TJobId>,
): SpyStateAdapter<TTxContext, TJobId> => {
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

  const wrap = <T extends (...args: never[]) => Promise<unknown>>(name: string, fn: T): T =>
    (async (...args: unknown[]) => {
      const params = args[0] as { txCtx?: TTxContext };
      const call = record({ txCtx: params?.txCtx, name });
      call.result = await fn(...(args as Parameters<T>));
      return call.result;
    }) as unknown as T;

  return {
    calls,

    config: stateAdapter.config,
    withTransaction: async (fn) => {
      const call = record({ txCtx: undefined, name: "withTransaction" });
      try {
        const result = await stateAdapter.withTransaction(async (txCtx) => {
          const spyRef = Symbol();
          weakMap.set(spyRef, call);
          return fn({ ...txCtx, spyRef });
        });
        call.status = "committed";
        return result;
      } catch (error) {
        call.status = "rolled-back";
        throw error;
      }
    },
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
    startWorker: wrap("startWorker", stateAdapter.startWorker),
    extendWorkerLease: wrap("extendWorkerLease", stateAdapter.extendWorkerLease),
    stopWorker: wrap("stopWorker", stateAdapter.stopWorker),
    getWorkers: wrap("getWorkers", stateAdapter.getWorkers),
    listWorkers: wrap("listWorkers", stateAdapter.listWorkers),
    countWorkersByTypeNames: wrap("countWorkersByTypeNames", stateAdapter.countWorkersByTypeNames),
    listWorkerJobs: wrap("listWorkerJobs", stateAdapter.listWorkerJobs),
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
