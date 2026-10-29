import { type StateJob } from "../state-adapter/state-adapter.js";
import { type TransactionHooks } from "../transaction-hooks.js";
import { type NotifyAdapter } from "./notify-adapter.js";

const notifyJobsScheduledKey = Symbol("queuert.notifyJobsScheduled");
const notifyChainsCompletedKey = Symbol("queuert.notifyChainsCompleted");
const notifyJobAttemptsLostKey = Symbol("queuert.notifyJobAttemptsLost");

export const bufferNotifyJobScheduled = (
  transactionHooks: TransactionHooks,
  notifyAdapter: NotifyAdapter,
  job: StateJob,
): void => {
  transactionHooks
    .getOrInsert(notifyJobsScheduledKey, () => ({
      state: new Set<string>(),
      flush: async (state) => {
        if (state.size === 0) return;
        try {
          await notifyAdapter.notifyJobsScheduled(Array.from(state));
        } catch {}
      },
      checkpoint: (state) => {
        const snapshot = new Set(state);
        return () => {
          state.clear();
          for (const v of snapshot) state.add(v);
        };
      },
    }))
    .add(job.typeName);
};

export const bufferNotifyChainCompletion = (
  transactionHooks: TransactionHooks,
  notifyAdapter: NotifyAdapter,
  job: StateJob,
): void => {
  transactionHooks
    .getOrInsert(notifyChainsCompletedKey, () => ({
      state: new Set<string>(),
      flush: async (state) => {
        if (state.size === 0) return;
        try {
          await notifyAdapter.notifyChainsCompleted(Array.from(state));
        } catch {}
      },
      checkpoint: (state) => {
        const snapshot = new Set(state);
        return () => {
          state.clear();
          for (const v of snapshot) state.add(v);
        };
      },
    }))
    .add(job.chainId);
};

export const bufferNotifyJobAttemptLost = (
  transactionHooks: TransactionHooks,
  notifyAdapter: NotifyAdapter,
  jobId: string,
): void => {
  transactionHooks
    .getOrInsert(notifyJobAttemptsLostKey, () => ({
      state: new Set<string>(),
      flush: async (state) => {
        if (state.size === 0) return;
        try {
          await notifyAdapter.notifyJobAttemptsLost(Array.from(state));
        } catch {}
      },
      checkpoint: (state) => {
        const snapshot = new Set(state);
        return () => {
          state.clear();
          for (const v of snapshot) state.add(v);
        };
      },
    }))
    .add(jobId);
};
