import type { ObservabilityHelper } from "../observability-adapter/observability-helper.ts";
import type { NotifyAdapter } from "./notify-adapter.ts";

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
  ): T => {
    const onError = (error: unknown): never => {
      observabilityHelper.notifyAdapterError(operationName, error);
      throw error;
    };
    // oxlint-disable-next-line typescript/promise-function-async -- an async wrapper would add a promise per adapter call
    return ((...args) => {
      try {
        return fn(...args).catch(onError);
      } catch (error) {
        // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- re-rejecting a caught error
        return Promise.reject(error).catch(onError);
      }
    }) as T;
  };

  return {
    notifyJobsScheduled: wrap("notifyJobsScheduled", notifyAdapter.notifyJobsScheduled),
    listenJobScheduled: wrap("listenJobScheduled", notifyAdapter.listenJobScheduled),
    notifyChainsCompleted: wrap("notifyChainsCompleted", notifyAdapter.notifyChainsCompleted),
    listenChainCompleted: wrap("listenChainCompleted", notifyAdapter.listenChainCompleted),
    notifyJobAttemptsLost: wrap("notifyJobAttemptsLost", notifyAdapter.notifyJobAttemptsLost),
    listenJobAttemptLost: wrap("listenJobAttemptLost", notifyAdapter.listenJobAttemptLost),
    close: notifyAdapter.close,
    [Symbol.asyncDispose]: notifyAdapter.close,
  };
};
