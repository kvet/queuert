import { type NotifyAdapter } from "./notify-adapter.js";

export type NotifySpyCall = {
  name: "notifyJobsScheduled" | "notifyChainsCompleted" | "notifyJobAttemptsLost";
  args: string[];
};

export type SpyNotifyAdapter = NotifyAdapter & {
  calls: NotifySpyCall[];
};

export const createSpyNotifyAdapter = (notifyAdapter: NotifyAdapter): SpyNotifyAdapter => {
  const calls: NotifySpyCall[] = [];

  const wrap =
    (name: NotifySpyCall["name"]) =>
    async (args: string[]): Promise<void> => {
      calls.push({ name, args });
      await notifyAdapter[name](args);
    };

  return {
    calls,

    notifyJobsScheduled: wrap("notifyJobsScheduled"),
    listenJobScheduled: notifyAdapter.listenJobScheduled,
    notifyChainsCompleted: wrap("notifyChainsCompleted"),
    listenChainCompleted: notifyAdapter.listenChainCompleted,
    notifyJobAttemptsLost: wrap("notifyJobAttemptsLost"),
    listenJobAttemptLost: notifyAdapter.listenJobAttemptLost,
    close: notifyAdapter.close,
  };
};
