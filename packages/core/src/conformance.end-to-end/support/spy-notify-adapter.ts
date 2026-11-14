import { type Mode, type MaybePromise, step, syncAsync } from "@queuert/sync-async";

import { runInModeOf } from "../../conformance/adapters.ts";
import type { NotifyAdapter } from "../../notify-adapter/notify-adapter.ts";

export type NotifySpyCall = {
  name: "notifyJobsScheduled" | "notifyChainsCompleted" | "notifyJobAttemptsLost";
  args: string[];
};

export type SpyNotifyAdapter<TNotifyAdapter extends NotifyAdapter<Mode>> = TNotifyAdapter & {
  calls: NotifySpyCall[];
};

export const createSpyNotifyAdapter = <TNotifyAdapter extends NotifyAdapter<Mode>>(
  notifyAdapter: TNotifyAdapter,
): SpyNotifyAdapter<TNotifyAdapter> => {
  const calls: NotifySpyCall[] = [];

  const wrap =
    (name: NotifySpyCall["name"]) =>
    (args: string[]): MaybePromise<void> => {
      calls.push({ name, args });
      return runInModeOf(
        notifyAdapter,
        syncAsync(function* () {
          yield* step(notifyAdapter[name](args));
        }),
      );
    };

  return {
    ...notifyAdapter,
    calls,
    notifyJobsScheduled: wrap("notifyJobsScheduled"),
    notifyChainsCompleted: wrap("notifyChainsCompleted"),
    notifyJobAttemptsLost: wrap("notifyJobAttemptsLost"),
  } as unknown as SpyNotifyAdapter<TNotifyAdapter>;
};
