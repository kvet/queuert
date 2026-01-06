import type { NotifyAdapter } from "./notify-adapter.js";

const noop = async (): Promise<void> => {};

export const createNoopNotifyAdapter = (): NotifyAdapter => {
  return {
    notifyJobScheduled: async () => {},
    listenJobScheduled: async () => noop,
    notifyJobSequenceCompleted: async () => {},
    listenJobSequenceCompleted: async () => noop,
    notifyJobOwnershipLost: async () => {},
    listenJobOwnershipLost: async () => noop,
  };
};
