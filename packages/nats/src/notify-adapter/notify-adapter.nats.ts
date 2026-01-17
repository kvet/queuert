import type { KV, NatsConnection } from "nats";
import type { NotifyAdapter } from "queuert";

export type CreateNatsNotifyAdapterOptions = {
  nc: NatsConnection;
  kv?: KV;
  subjectPrefix?: string;
};

type SharedListenerState =
  | { status: "idle" }
  | { status: "starting"; readyPromise: Promise<void> }
  | {
      status: "running";
      callbacks: Set<(payload: string) => void>;
      unsubscribe: () => Promise<void>;
    }
  | { status: "stopping"; stoppedPromise: Promise<void> };

const createSharedListener = (
  nc: NatsConnection,
  subject: string,
): {
  subscribe: (callback: (payload: string) => void) => Promise<() => Promise<void>>;
} => {
  let state: SharedListenerState = { status: "idle" };

  const ensureRunning = async (): Promise<Set<(payload: string) => void>> => {
    while (true) {
      if (state.status === "idle") {
        const callbacks = new Set<(payload: string) => void>();
        const { promise: readyPromise, resolve: resolveReady } = Promise.withResolvers<void>();

        state = { status: "starting", readyPromise };

        const subscription = nc.subscribe(subject, {
          callback: (_err, msg) => {
            if (state.status === "running") {
              const payload = new TextDecoder().decode(msg.data);
              for (const cb of state.callbacks) {
                cb(payload);
              }
            }
          },
        });

        const unsubscribe = async (): Promise<void> => {
          subscription.unsubscribe();
        };

        resolveReady();
        state = { status: "running", callbacks, unsubscribe };
        return callbacks;
      }

      if (state.status === "starting") {
        await state.readyPromise;
        continue;
      }

      if (state.status === "running") {
        return state.callbacks;
      }

      if (state.status === "stopping") {
        await state.stoppedPromise;
        continue;
      }

      throw new Error(`Unknown state: ${(state as { status: string }).status}`);
    }
  };

  const stopIfEmpty = async (): Promise<void> => {
    if (state.status !== "running") return;
    if (state.callbacks.size > 0) return;

    const { unsubscribe } = state;
    const stoppedPromise = unsubscribe();
    state = { status: "stopping", stoppedPromise };

    await stoppedPromise;
    state = { status: "idle" };
  };

  return {
    subscribe: async (callback) => {
      const callbacks = await ensureRunning();
      callbacks.add(callback);

      return async () => {
        callbacks.delete(callback);
        await stopIfEmpty();
      };
    },
  };
};

const tryDecrementHint = async (kv: KV, key: string): Promise<boolean> => {
  const maxRetries = 5;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const entry = await kv.get(key);
      if (!entry) return false;

      const current = parseInt(new TextDecoder().decode(entry.value), 10);
      if (current <= 0) return false;

      const newValue = current - 1;
      await kv.update(key, new TextEncoder().encode(String(newValue)), entry.revision);
      return true;
    } catch (err) {
      if (err instanceof Error && err.message.includes("wrong last sequence")) {
        continue;
      }
      return false;
    }
  }
  return false;
};

export const createNatsNotifyAdapter = async ({
  nc,
  kv,
  subjectPrefix = "queuert",
}: CreateNatsNotifyAdapterOptions): Promise<NotifyAdapter> => {
  const jobScheduledSubject = `${subjectPrefix}.sched`;
  const chainCompletedSubject = `${subjectPrefix}.chainc`;
  const ownershipLostSubject = `${subjectPrefix}.owls`;
  const hintKeyPrefix = `${subjectPrefix}_hint_`;

  const jobScheduledListener = createSharedListener(nc, jobScheduledSubject);
  const chainCompletedListener = createSharedListener(nc, chainCompletedSubject);
  const ownershipLostListener = createSharedListener(nc, ownershipLostSubject);

  return {
    notifyJobScheduled: async (typeName, count) => {
      const hintId = crypto.randomUUID();
      const payload = `${hintId}:${typeName}`;

      if (kv) {
        const hintKey = `${hintKeyPrefix}${hintId}`;
        await kv.put(hintKey, new TextEncoder().encode(String(count)));
      }

      nc.publish(jobScheduledSubject, new TextEncoder().encode(payload));
    },

    listenJobScheduled: async (typeNames, onNotification) => {
      const typeNameSet = new Set(typeNames);

      return jobScheduledListener.subscribe((payload) => {
        const separatorIndex = payload.indexOf(":");
        if (separatorIndex === -1) return;

        const hintId = payload.slice(0, separatorIndex);
        const typeName = payload.slice(separatorIndex + 1);

        if (!typeNameSet.has(typeName)) return;

        if (kv) {
          const hintKey = `${hintKeyPrefix}${hintId}`;
          void tryDecrementHint(kv, hintKey).then((success) => {
            if (success) {
              onNotification(typeName);
            }
          });
        } else {
          onNotification(typeName);
        }
      });
    },

    notifyJobChainCompleted: async (chainId) => {
      nc.publish(chainCompletedSubject, new TextEncoder().encode(chainId));
    },

    listenJobChainCompleted: async (chainId, onNotification) => {
      return chainCompletedListener.subscribe((payload) => {
        if (payload === chainId) {
          onNotification();
        }
      });
    },

    notifyJobOwnershipLost: async (jobId) => {
      nc.publish(ownershipLostSubject, new TextEncoder().encode(jobId));
    },

    listenJobOwnershipLost: async (jobId, onNotification) => {
      return ownershipLostListener.subscribe((payload) => {
        if (payload === jobId) {
          onNotification();
        }
      });
    },
  };
};
