import { type CommitHooks } from "../commit-hooks.js";
import { type NotifyAdapter } from "../notify-adapter/notify-adapter.js";
import { type StateJob } from "../state-adapter/state-adapter.js";

const queuertNotifyJobScheduled = Symbol("queuertNotifyJobScheduled");
const queuertNotifyChainCompleted = Symbol("queuertNotifyChainCompleted");
const queuertNotifyJobOwnershipLost = Symbol("queuertNotifyJobOwnershipLost");

export const bufferNotifyJobScheduled = (
  commitHooks: CommitHooks,
  notifyAdapter: NotifyAdapter,
  job: StateJob,
): void => {
  const state = commitHooks.getOrInsert(queuertNotifyJobScheduled, () => ({
    state: new Map<string, number>(),
    flush: async (state) => {
      await Promise.all(
        Array.from(state.entries()).map(async ([typeName, count]) => {
          try {
            await notifyAdapter.notifyJobScheduled(typeName, count);
          } catch {}
        }),
      );
    },
  }));
  state.set(job.typeName, (state.get(job.typeName) ?? 0) + 1);
};

export const bufferNotifyChainCompletion = (
  commitHooks: CommitHooks,
  notifyAdapter: NotifyAdapter,
  job: StateJob,
): void => {
  commitHooks
    .getOrInsert(queuertNotifyChainCompleted, () => ({
      state: new Set<string>(),
      flush: async (state) => {
        await Promise.all(
          Array.from(state).map(async (chainId) => {
            try {
              await notifyAdapter.notifyJobChainCompleted(chainId);
            } catch {}
          }),
        );
      },
    }))
    .add(job.chainId);
};

export const bufferNotifyJobOwnershipLost = (
  commitHooks: CommitHooks,
  notifyAdapter: NotifyAdapter,
  jobId: string,
): void => {
  commitHooks
    .getOrInsert(queuertNotifyJobOwnershipLost, () => ({
      state: new Set<string>(),
      flush: async (state) => {
        await Promise.all(
          Array.from(state).map(async (jobId) => {
            try {
              await notifyAdapter.notifyJobOwnershipLost(jobId);
            } catch {}
          }),
        );
      },
    }))
    .add(jobId);
};
