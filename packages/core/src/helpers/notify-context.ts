import { AsyncLocalStorage } from "node:async_hooks";
import { type UUID } from "node:crypto";
import { type NotifyAdapter } from "../notify-adapter/notify-adapter.js";
import { type ObservabilityHelper } from "../observability-adapter/observability-helper.js";
import { type StateJob } from "../state-adapter/state-adapter.js";

export const notifyCompletionStorage = new AsyncLocalStorage<{
  storeId: UUID;
  jobTypeCounts: Map<string, number>;
  chainIds: Set<string>;
  jobOwnershipLostIds: Set<string>;
}>();

export const withNotifyContext = async <T>(
  notifyAdapter: NotifyAdapter,
  cb: () => Promise<T>,
): Promise<T> => {
  if (notifyCompletionStorage.getStore()) {
    return cb();
  }

  const store = {
    storeId: crypto.randomUUID(),
    jobTypeCounts: new Map<string, number>(),
    chainIds: new Set<string>(),
    jobOwnershipLostIds: new Set<string>(),
  };
  return notifyCompletionStorage.run(store, async () => {
    const result = await cb();

    await Promise.all([
      ...Array.from(store.jobTypeCounts.entries()).map(async ([typeName, count]) => {
        try {
          await notifyAdapter.notifyJobScheduled(typeName, count);
        } catch {}
      }),
      ...Array.from(store.chainIds).map(async (chainId) => {
        try {
          await notifyAdapter.notifyJobChainCompleted(chainId);
        } catch {}
      }),
      ...Array.from(store.jobOwnershipLostIds).map(async (jobId) => {
        try {
          await notifyAdapter.notifyJobOwnershipLost(jobId);
        } catch {}
      }),
    ]);

    return result;
  });
};

export const notifyJobScheduled = (
  job: StateJob,
  notifyAdapterOption: NotifyAdapter | undefined,
  observabilityHelper: ObservabilityHelper,
): void => {
  const store = notifyCompletionStorage.getStore();
  if (store) {
    store.jobTypeCounts.set(job.typeName, (store.jobTypeCounts.get(job.typeName) ?? 0) + 1);
  } else if (notifyAdapterOption) {
    observabilityHelper.notifyContextAbsence(job);
  }
};

export const notifyChainCompletion = (job: StateJob): void => {
  const store = notifyCompletionStorage.getStore();
  if (store) {
    store.chainIds.add(job.chainId);
  }
};

export const notifyJobOwnershipLost = (jobId: string): void => {
  const store = notifyCompletionStorage.getStore();
  if (store) {
    store.jobOwnershipLostIds.add(jobId);
  }
};
