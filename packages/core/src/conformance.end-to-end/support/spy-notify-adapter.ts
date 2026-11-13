import { andThen, type MaybePromise } from "@queuert/helpers/maybe-promise";

import type { ConformanceNotifyAdapter } from "../../conformance/adapters.ts";

export type NotifySpyCall = {
  name: "notifyJobsScheduled" | "notifyChainsCompleted" | "notifyJobAttemptsLost";
  args: string[];
};

export type SpyNotifyAdapter<TNotifyAdapter extends ConformanceNotifyAdapter> = TNotifyAdapter & {
  calls: NotifySpyCall[];
};

export const createSpyNotifyAdapter = <TNotifyAdapter extends ConformanceNotifyAdapter>(
  notifyAdapter: TNotifyAdapter,
): SpyNotifyAdapter<TNotifyAdapter> => {
  const calls: NotifySpyCall[] = [];

  const wrap =
    (name: NotifySpyCall["name"]) =>
    (args: string[]): MaybePromise<void> => {
      calls.push({ name, args });
      return andThen(notifyAdapter[name](args), () => undefined);
    };

  return {
    ...notifyAdapter,
    calls,
    notifyJobsScheduled: wrap("notifyJobsScheduled"),
    notifyChainsCompleted: wrap("notifyChainsCompleted"),
    notifyJobAttemptsLost: wrap("notifyJobAttemptsLost"),
  } as unknown as SpyNotifyAdapter<TNotifyAdapter>;
};
