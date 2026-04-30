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
    notifyJobOwnershipLost: async () => {},
    listenJobOwnershipLost: async () => noop,
    close: async () => {},
  };
};
