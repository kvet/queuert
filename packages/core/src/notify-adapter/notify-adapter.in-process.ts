import { NotifyAdapter } from "./notify-adapter.js";

export const createInProcessNotifyAdapter = (): NotifyAdapter => {
  const listeners: Array<(typeName: string) => boolean> = [];

  return {
    notifyJobScheduled: async (typeName: string) => {
      for (const listener of listeners) {
        if (listener(typeName)) {
          break;
        }
      }
    },
    listenJobScheduled: (typeNames: string[], { signal }: { signal?: AbortSignal }) => {
      return new Promise<void>((resolve) => {
        if (signal?.aborted) return resolve();

        const cleanup = () => {
          const index = listeners.indexOf(listener);
          if (index !== -1) {
            listeners.splice(index, 1);
          }
        };

        const listener = (notifiedTypeName: string) => {
          if (typeNames.includes(notifiedTypeName)) {
            cleanup();
            signal?.removeEventListener("abort", onAbort);
            resolve();
            return true;
          }
          return false;
        };

        const onAbort = () => {
          cleanup();
          resolve();
        };

        listeners.push(listener);
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    },
  };
};
