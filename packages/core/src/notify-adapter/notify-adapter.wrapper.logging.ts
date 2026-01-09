import { LogHelper } from "../log-helper.js";
import { NotifyAdapter } from "./notify-adapter.js";

export const wrapNotifyAdapterWithLogging = ({
  notifyAdapter,
  logHelper,
}: {
  notifyAdapter: NotifyAdapter;
  logHelper: LogHelper;
}): NotifyAdapter => {
  const wrap = <T extends (...args: never[]) => Promise<unknown>>(
    operationName: string,
    fn: T,
  ): T =>
    (async (...args) => {
      try {
        return await fn(...args);
      } catch (error) {
        logHelper.notifyAdapterError(operationName, error);
        throw error;
      }
    }) as T;

  return {
    notifyJobScheduled: wrap("notifyJobScheduled", notifyAdapter.notifyJobScheduled),
    listenJobScheduled: wrap("listenJobScheduled", notifyAdapter.listenJobScheduled),
    notifyJobSequenceCompleted: wrap(
      "notifyJobSequenceCompleted",
      notifyAdapter.notifyJobSequenceCompleted,
    ),
    listenJobSequenceCompleted: wrap(
      "listenJobSequenceCompleted",
      notifyAdapter.listenJobSequenceCompleted,
    ),
    notifyJobOwnershipLost: wrap("notifyJobOwnershipLost", notifyAdapter.notifyJobOwnershipLost),
    listenJobOwnershipLost: wrap("listenJobOwnershipLost", notifyAdapter.listenJobOwnershipLost),
  };
};
