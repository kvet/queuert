import { type NotifyAdapter } from "./notify-adapter.js";

const noop = async (): Promise<void> => {};

export const createNoopNotifyAdapter = (): NotifyAdapter => {
  return {
    notifyJobScheduled: async () => {},
    listenJobScheduled: async () => noop,
    provideWakeHint: async () => {},
    consumeWakeHint: async () => true,
    notifyChainCompleted: async () => {},
    listenChainCompleted: async () => noop,
    notifyJobAttemptLost: async () => {},
    listenJobAttemptLost: async () => noop,
    close: async () => {},
  };
};
