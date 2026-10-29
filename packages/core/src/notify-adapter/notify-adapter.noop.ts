import { type NotifyAdapter } from "./notify-adapter.js";

const noop = async (): Promise<void> => {};
const returnNoop = async () => noop;

export const createNoopNotifyAdapter = (): NotifyAdapter => {
  return {
    notifyJobsScheduled: noop,
    listenJobScheduled: returnNoop,
    notifyChainsCompleted: noop,
    listenChainCompleted: returnNoop,
    notifyJobAttemptsLost: noop,
    listenJobAttemptLost: returnNoop,
    close: noop,
  };
};
