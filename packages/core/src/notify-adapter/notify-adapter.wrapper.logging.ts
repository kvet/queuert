import { reportErrors } from "@queuert/helpers/report-errors";
import { type MaybePromise, type Mode, step, syncAsync } from "@queuert/sync-async";

import type { ObservabilityHelper } from "../observability-adapter/observability-helper.ts";
import type { NotifyAdapter } from "./notify-adapter.ts";

export const wrapNotifyAdapterWithLogging = <TNotifyAdapter extends NotifyAdapter<Mode>>({
  notifyAdapter,
  observabilityHelper,
}: {
  notifyAdapter: TNotifyAdapter;
  observabilityHelper: ObservabilityHelper;
}): TNotifyAdapter => {
  const sync = notifyAdapter.sync === true;
  const wrap = <T extends (...args: never[]) => unknown>(
    operationName: Extract<keyof NotifyAdapter<Mode>, string>,
    fn: T,
  ): T =>
    reportErrors(
      fn,
      (error) => {
        observabilityHelper.notifyAdapterError(operationName, error);
      },
      { sync },
    );
  const wrapListen = <T extends (...args: never[]) => unknown>(
    operationName: Extract<keyof NotifyAdapter<Mode>, string>,
    listen: T,
  ): T => {
    const reportedListen = wrap(operationName, listen);
    const listenReportingDispose = syncAsync(function* (...args: Parameters<T>) {
      const dispose = yield* step(reportedListen(...args) as MaybePromise<() => unknown>);
      return wrap(operationName, dispose);
    });
    return (sync ? listenReportingDispose.sync : listenReportingDispose.async) as unknown as T;
  };

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
