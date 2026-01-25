import { type ObservabilityHelper } from "../observability-adapter/observability-helper.js";
import { type NotifyAdapter } from "./notify-adapter.js";

export const wrapNotifyAdapterWithLogging = ({
  notifyAdapter,
  observabilityHelper,
}: {
  notifyAdapter: NotifyAdapter;
  observabilityHelper: ObservabilityHelper;
}): NotifyAdapter => {
  const wrap = <T extends (...args: never[]) => Promise<unknown>>(
    operationName: keyof NotifyAdapter,
    fn: T,
  ): T =>
    (async (...args) => {
      try {
        return await fn(...args);
      } catch (error) {
        observabilityHelper.notifyAdapterError(operationName, error);
        throw error;
      }
    }) as T;

  return {
    notifyJobScheduled: wrap("notifyJobScheduled", notifyAdapter.notifyJobScheduled),
    listenJobScheduled: wrap("listenJobScheduled", notifyAdapter.listenJobScheduled),
    notifyJobChainCompleted: wrap("notifyJobChainCompleted", notifyAdapter.notifyJobChainCompleted),
    listenJobChainCompleted: wrap("listenJobChainCompleted", notifyAdapter.listenJobChainCompleted),
    notifyJobOwnershipLost: wrap("notifyJobOwnershipLost", notifyAdapter.notifyJobOwnershipLost),
    listenJobOwnershipLost: wrap("listenJobOwnershipLost", notifyAdapter.listenJobOwnershipLost),
  };
};
