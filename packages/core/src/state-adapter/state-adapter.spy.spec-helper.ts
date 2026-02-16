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

  const record = ({ txContext, name }: { txContext?: TTxContext; name: string }): SpyCall => {
    const call: SpyCall = { name, children: [] };
    const spyRef = (txContext as TTxContext & { spyRef?: symbol })?.spyRef;
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
      record({ txContext: (args[0] as any).txContext, name });
      return fn(...(args as Parameters<T>));
    }) as unknown as T;

  return {
    calls,

    runInTransaction: async (fn) => {
      const call = record({ txContext: undefined, name: "runInTransaction" });
      try {
        const result = await stateAdapter.runInTransaction(async (txContext) => {
          const spyRef = Symbol();
          weakMap.set(spyRef, call);
          return fn({ ...txContext, spyRef });
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
    scheduleBlockedJobs: wrap("scheduleBlockedJobs", stateAdapter.scheduleBlockedJobs),
    getJobBlockers: wrap("getJobBlockers", stateAdapter.getJobBlockers),
    getNextJobAvailableInMs: wrap("getNextJobAvailableInMs", stateAdapter.getNextJobAvailableInMs),
    acquireJob: wrap("acquireJob", stateAdapter.acquireJob),
    renewJobLease: wrap("renewJobLease", stateAdapter.renewJobLease),
    rescheduleJob: wrap("rescheduleJob", stateAdapter.rescheduleJob),
    completeJob: wrap("completeJob", stateAdapter.completeJob),
    removeExpiredJobLease: wrap("removeExpiredJobLease", stateAdapter.removeExpiredJobLease),
    deleteJobsByChainIds: wrap("deleteJobsByChainIds", stateAdapter.deleteJobsByChainIds),
    getJobForUpdate: wrap("getJobForUpdate", stateAdapter.getJobForUpdate),
    getCurrentJobForUpdate: wrap("getCurrentJobForUpdate", stateAdapter.getCurrentJobForUpdate),

    record: async ({ name, ...txContext }: { name: string } & TTxContext) =>
      record({ name, txContext: txContext as unknown as TTxContext }),
  };
};
