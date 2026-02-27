import { type BaseTxContext, type StateAdapter } from "./state-adapter.js";

export type SpyCall = {
  name: string;
  children: SpyCall[];
  status?: "committed" | "rolled-back";
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
      record({ txCtx: (args[0] as any).txCtx, name });
      return fn(...(args as Parameters<T>));
    }) as unknown as T;

  return {
    calls,

    runInTransaction: async (fn) => {
      const call = record({ txCtx: undefined, name: "runInTransaction" });
      try {
        const result = await stateAdapter.runInTransaction(async (txCtx) => {
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
    getJobChainById: wrap("getJobChainById", stateAdapter.getJobChainById),
    getJobById: wrap("getJobById", stateAdapter.getJobById),
    createJob: wrap("createJob", stateAdapter.createJob),
    addJobBlockers: wrap("addJobBlockers", stateAdapter.addJobBlockers),
    unblockJobs: wrap("unblockJobs", stateAdapter.unblockJobs),
    getJobBlockers: wrap("getJobBlockers", stateAdapter.getJobBlockers),
    getNextJobAvailableInMs: wrap("getNextJobAvailableInMs", stateAdapter.getNextJobAvailableInMs),
    acquireJob: wrap("acquireJob", stateAdapter.acquireJob),
    renewJobLease: wrap("renewJobLease", stateAdapter.renewJobLease),
    rescheduleJob: wrap("rescheduleJob", stateAdapter.rescheduleJob),
    completeJob: wrap("completeJob", stateAdapter.completeJob),
    reapExpiredJobLease: wrap("reapExpiredJobLease", stateAdapter.reapExpiredJobLease),
    deleteJobChains: wrap("deleteJobChains", stateAdapter.deleteJobChains),
    getJobForUpdate: wrap("getJobForUpdate", stateAdapter.getJobForUpdate),
    getLatestChainJobForUpdate: wrap(
      "getLatestChainJobForUpdate",
      stateAdapter.getLatestChainJobForUpdate,
    ),
    listJobChains: wrap("listJobChains", stateAdapter.listJobChains),
    listJobs: wrap("listJobs", stateAdapter.listJobs),
    listJobChainJobs: wrap("listJobChainJobs", stateAdapter.listJobChainJobs),
    listBlockedJobs: wrap("listBlockedJobs", stateAdapter.listBlockedJobs),

    record: async ({ name, ...txCtx }: { name: string } & TTxContext) =>
      record({ name, txCtx: txCtx as unknown as TTxContext }),
  };
};
