import { NotifyAdapter } from "./notify-adapter.js";

export const createInProcessNotifyAdapter = (): NotifyAdapter => {
  const listeners: Array<(queueName: string) => boolean> = [];

  return {
    notifyJobScheduled: async (queueName: string) => {
      for (const listener of listeners) {
        if (listener(queueName)) {
          break;
        }
      }
    },
    listenJobScheduled: (
      queueNames: string[],
      { signal }: { signal?: AbortSignal }
    ) => {
      return new Promise<void>((resolve, reject) => {
        const listener = (notifiedQueueName: string) => {
          if (queueNames.includes(notifiedQueueName)) {
            resolve();
            return true;
          }
          return false;
        };
        listeners.push(listener);

        const cleanup = () => {
          const index = listeners.indexOf(listener);
          if (index !== -1) {
            listeners.splice(index, 1);
          }
        };

        if (signal) {
          signal.addEventListener("abort", () => {
            cleanup();
            reject(new Error("Listener aborted"));
          });
        }
      });
    },
  };
};
