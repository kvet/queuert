import { type TransactionHooks } from "../transaction-hooks.js";
import { type NotifyAdapter } from "../notify-adapter/notify-adapter.js";
import { type StateJob } from "../state-adapter/state-adapter.js";

const queuertNotifyJobScheduled = Symbol("queuert.notifyJobScheduled");
const queuertNotifyChainCompleted = Symbol("queuert.notifyChainCompleted");
const queuertNotifyJobOwnershipLost = Symbol("queuert.notifyJobOwnershipLost");

export const bufferNotifyJobScheduled = (
  transactionHooks: TransactionHooks,
  notifyAdapter: NotifyAdapter,
  job: StateJob,
): void => {
  const state = transactionHooks.getOrInsert(queuertNotifyJobScheduled, () => ({
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
  transactionHooks: TransactionHooks,
  notifyAdapter: NotifyAdapter,
  job: StateJob,
): void => {
  transactionHooks
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
  transactionHooks: TransactionHooks,
  notifyAdapter: NotifyAdapter,
  jobId: string,
): void => {
  transactionHooks
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
