import { reportErrors } from "@queuert/helpers/report-errors.async-only";

import type { ObservabilityHelper } from "../observability-adapter/observability-helper.ts";
import type { NotifyAdapter } from "./notify-adapter.ts";

// unasync: rename wrapSyncNotifyAdapterWithLogging
export const wrapNotifyAdapterWithLogging = ({
  notifyAdapter,
  observabilityHelper,
}: {
  notifyAdapter: NotifyAdapter;
  observabilityHelper: ObservabilityHelper;
}): NotifyAdapter => {
  const wrap = <T extends (...args: never[]) => Promise<unknown>>(
    operationName: Extract<keyof NotifyAdapter, string>,
    fn: T,
  ): T =>
    reportErrors(fn, (error) => {
      observabilityHelper.notifyAdapterError(operationName, error);
    });
  const wrapListen = <T extends (...args: never[]) => Promise<() => Promise<void>>>(
    operationName: Extract<keyof NotifyAdapter, string>,
    listen: T,
  ): T =>
    wrap(operationName, (async (...args: Parameters<T>) =>
      wrap(operationName, await listen(...args))) as T);

  return {
    notifyJobsScheduled: wrap("notifyJobsScheduled", notifyAdapter.notifyJobsScheduled),
    listenJobScheduled: wrapListen("listenJobScheduled", notifyAdapter.listenJobScheduled),
    notifyChainsCompleted: wrap("notifyChainsCompleted", notifyAdapter.notifyChainsCompleted),
    listenChainCompleted: wrapListen("listenChainCompleted", notifyAdapter.listenChainCompleted),
    notifyJobAttemptsLost: wrap("notifyJobAttemptsLost", notifyAdapter.notifyJobAttemptsLost),
    listenJobAttemptLost: wrapListen("listenJobAttemptLost", notifyAdapter.listenJobAttemptLost),
    close: notifyAdapter.close,
    [Symbol.asyncDispose]: notifyAdapter.close,
  };
};
