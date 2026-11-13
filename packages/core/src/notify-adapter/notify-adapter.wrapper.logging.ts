import { andThen } from "@queuert/helpers/maybe-promise";
import { reportErrors } from "@queuert/helpers/report-errors";

import { isSyncAdapter } from "../adapter-mode.ts";
import type { ObservabilityHelper } from "../observability-adapter/observability-helper.ts";
import type { AnyNotifyAdapter } from "./notify-adapter.ts";

export const wrapNotifyAdapterWithLogging = <TNotifyAdapter extends AnyNotifyAdapter>({
  notifyAdapter,
  observabilityHelper,
}: {
  notifyAdapter: TNotifyAdapter;
  observabilityHelper: ObservabilityHelper;
}): TNotifyAdapter => {
  // An async adapter's callers expect a promise, so a synchronous throw from it becomes a rejection.
  const rejectSyncThrows = !isSyncAdapter(notifyAdapter);
  const wrap = <T extends (...args: never[]) => unknown>(
    operationName: Extract<keyof AnyNotifyAdapter, string>,
    fn: T,
  ): T =>
    reportErrors(
      fn,
      (error) => {
        observabilityHelper.notifyAdapterError(operationName, error);
      },
      { rejectSyncThrows },
    );
  const wrapListen = <T extends (...args: never[]) => unknown>(
    operationName: Extract<keyof AnyNotifyAdapter, string>,
    listen: T,
  ): T =>
    wrap(operationName, ((...args: Parameters<T>) =>
      andThen(listen(...args) as (() => unknown) | Promise<() => unknown>, (dispose) =>
        wrap(operationName, dispose),
      )) as unknown as T);

  return {
    ...notifyAdapter,
    notifyJobsScheduled: wrap("notifyJobsScheduled", notifyAdapter.notifyJobsScheduled),
    listenJobScheduled: wrapListen("listenJobScheduled", notifyAdapter.listenJobScheduled),
    notifyChainsCompleted: wrap("notifyChainsCompleted", notifyAdapter.notifyChainsCompleted),
    listenChainCompleted: wrapListen("listenChainCompleted", notifyAdapter.listenChainCompleted),
    notifyJobAttemptsLost: wrap("notifyJobAttemptsLost", notifyAdapter.notifyJobAttemptsLost),
    listenJobAttemptLost: wrapListen("listenJobAttemptLost", notifyAdapter.listenJobAttemptLost),
  };
};
