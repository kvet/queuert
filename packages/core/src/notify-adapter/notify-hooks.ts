import { type StateJob } from "../state-adapter/state-adapter.js";
import { type TransactionHooks } from "../transaction-hooks.js";
import { type NotifyAdapter } from "./notify-adapter.js";

const notifyJobScheduledKey = Symbol("queuert.notifyJobScheduled");
const notifyChainCompletedKey = Symbol("queuert.notifyChainCompleted");
const notifyJobAttemptLostKey = Symbol("queuert.notifyJobAttemptLost");

export const notifyJobsScheduled = async (
  notifyAdapter: NotifyAdapter,
  typeName: string,
  count: number,
): Promise<void> => {
  try {
    await notifyAdapter.provideWakeHint(typeName, count);
    await notifyAdapter.notifyJobScheduled(typeName);
  } catch {}
};

export const bufferNotifyJobScheduled = (
  transactionHooks: TransactionHooks,
  notifyAdapter: NotifyAdapter,
  job: StateJob,
): void => {
  const state = transactionHooks.getOrInsert(notifyJobScheduledKey, () => ({
    state: new Map<string, number>(),
    flush: async (state) => {
      await Promise.all(
        Array.from(state.entries()).map(async ([typeName, count]) =>
          notifyJobsScheduled(notifyAdapter, typeName, count),
        ),
      );
    },
    checkpoint: (state) => {
      const snapshot = new Map(state);
      return () => {
        state.clear();
        for (const [k, v] of snapshot) state.set(k, v);
      };
    },
  }));
  state.set(job.typeName, (state.get(job.typeName) ?? 0) + 1);
};

const bufferDistinct = (
  transactionHooks: TransactionHooks,
  key: symbol,
  value: string,
  send: (value: string) => Promise<void>,
): void => {
  transactionHooks
    .getOrInsert(key, () => ({
      state: new Set<string>(),
      flush: async (state) => {
        await Promise.all(
          Array.from(state).map(async (bufferedValue) => {
            try {
              await send(bufferedValue);
            } catch {}
          }),
        );
      },
      checkpoint: (state) => {
        const snapshot = new Set(state);
        return () => {
          state.clear();
          for (const v of snapshot) state.add(v);
        };
      },
    }))
    .add(value);
};

export const bufferNotifyChainCompletion = (
  transactionHooks: TransactionHooks,
  notifyAdapter: NotifyAdapter,
  job: StateJob,
): void => {
  bufferDistinct(transactionHooks, notifyChainCompletedKey, job.chainId, async (chainId) =>
    notifyAdapter.notifyChainCompleted(chainId),
  );
};

export const bufferNotifyJobAttemptLost = (
  transactionHooks: TransactionHooks,
  notifyAdapter: NotifyAdapter,
  jobId: string,
): void => {
  bufferDistinct(transactionHooks, notifyJobAttemptLostKey, jobId, async (lostJobId) =>
    notifyAdapter.notifyJobAttemptLost(lostJobId),
  );
};
