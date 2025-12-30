import { NotifyAdapter } from "./notify-adapter.js";

export const createNoopNotifyAdapter = (): NotifyAdapter => {
  return {
    notifyJobScheduled: async () => {},
    listenJobScheduled: async (_typeNames, { signal }) => {
      return new Promise<void>((resolve) => {
        if (signal?.aborted) {
          resolve();
          return;
        }
        signal?.addEventListener(
          "abort",
          () => {
            resolve();
          },
          { once: true },
        );
      });
    },
    notifyJobSequenceCompleted: async () => {},
    listenJobSequenceCompleted: async (_sequenceIds, { signal }) => {
      return new Promise<string | undefined>((resolve) => {
        if (signal?.aborted) {
          resolve(undefined);
          return;
        }
        signal?.addEventListener(
          "abort",
          () => {
            resolve(undefined);
          },
          { once: true },
        );
      });
    },
    notifyJobOwnershipLost: async () => {},
    listenJobOwnershipLost: async (_jobIds, { signal }) => {
      return new Promise<string | undefined>((resolve) => {
        if (signal?.aborted) {
          resolve(undefined);
          return;
        }
        signal?.addEventListener(
          "abort",
          () => {
            resolve(undefined);
          },
          { once: true },
        );
      });
    },
  };
};
