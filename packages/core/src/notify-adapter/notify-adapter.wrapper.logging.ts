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
    notifyJobsScheduled: wrap("notifyJobsScheduled", notifyAdapter.notifyJobsScheduled),
    listenJobScheduled: wrap("listenJobScheduled", notifyAdapter.listenJobScheduled),
    notifyChainsCompleted: wrap("notifyChainsCompleted", notifyAdapter.notifyChainsCompleted),
    listenChainCompleted: wrap("listenChainCompleted", notifyAdapter.listenChainCompleted),
    notifyJobAttemptsLost: wrap("notifyJobAttemptsLost", notifyAdapter.notifyJobAttemptsLost),
    listenJobAttemptLost: wrap("listenJobAttemptLost", notifyAdapter.listenJobAttemptLost),
    close: notifyAdapter.close,
  };
};
