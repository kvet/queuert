import { wrapOperation } from "../helpers/wrap-operation.js";
import { LogHelper } from "../log-helper.js";
import { NotifyAdapter } from "./notify-adapter.js";

export const wrapNotifyAdapter = ({
  notifyAdapter,
  logHelper,
}: {
  notifyAdapter: NotifyAdapter;
  logHelper: LogHelper;
}): NotifyAdapter => {
  const wrap = <TKey extends keyof NotifyAdapter>(operation: TKey): NotifyAdapter[TKey] =>
    wrapOperation(notifyAdapter, operation, (op, error) => {
      logHelper.notifyAdapterError(op, error);
    });

  return {
    notifyJobScheduled: wrap("notifyJobScheduled"),
    listenJobScheduled: wrap("listenJobScheduled"),
    notifyJobSequenceCompleted: wrap("notifyJobSequenceCompleted"),
    listenJobSequenceCompleted: wrap("listenJobSequenceCompleted"),
    notifyJobOwnershipLost: wrap("notifyJobOwnershipLost"),
    listenJobOwnershipLost: wrap("listenJobOwnershipLost"),
  };
};
