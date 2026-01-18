import type { NotifyAdapter } from "queuert";
import type { RedisNotifyProvider } from "../notify-provider/notify-provider.redis.js";
import { DECR_IF_POSITIVE_SCRIPT, SET_AND_PUBLISH_SCRIPT } from "./lua.js";

export type CreateRedisNotifyAdapterOptions = {
  provider: RedisNotifyProvider;
  channelPrefix?: string;
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
  provider: RedisNotifyProvider,
  channel: string,
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

        const unsubscribe = await provider.subscribe(channel, (payload) => {
          if (state.status === "running") {
            for (const cb of state.callbacks) {
              cb(payload);
            }
          }
        });

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

export const createRedisNotifyAdapter = async ({
  provider,
  channelPrefix = "queuert",
}: CreateRedisNotifyAdapterOptions): Promise<NotifyAdapter> => {
  const jobScheduledChannel = `${channelPrefix}:sched`;
  const chainCompletedChannel = `${channelPrefix}:chainc`;
  const ownershipLostChannel = `${channelPrefix}:owls`;
  const hintKeyPrefix = `${channelPrefix}:hint:`;

  const jobScheduledListener = createSharedListener(provider, jobScheduledChannel);
  const chainCompletedListener = createSharedListener(provider, chainCompletedChannel);
  const ownershipLostListener = createSharedListener(provider, ownershipLostChannel);

  return {
    notifyJobScheduled: async (typeName, count) => {
      const hintId = crypto.randomUUID();
      const hintKey = `${hintKeyPrefix}${hintId}`;

      await provider.eval(
        SET_AND_PUBLISH_SCRIPT,
        [hintKey, jobScheduledChannel],
        [String(count), `${hintId}:${typeName}`],
      );
    },

    listenJobScheduled: async (typeNames, onNotification) => {
      const typeNameSet = new Set(typeNames);

      return jobScheduledListener.subscribe((payload) => {
        const separatorIndex = payload.indexOf(":");
        if (separatorIndex === -1) return;

        const hintId = payload.slice(0, separatorIndex);
        const typeName = payload.slice(separatorIndex + 1);

        if (!typeNameSet.has(typeName)) return;

        const hintKey = `${hintKeyPrefix}${hintId}`;
        void (async () => {
          const result = await provider.eval(DECR_IF_POSITIVE_SCRIPT, [hintKey], []);
          if (result === 1) {
            onNotification(typeName);
          }
        })();
      });
    },

    notifyJobChainCompleted: async (chainId) => {
      await provider.publish(chainCompletedChannel, chainId);
    },

    listenJobChainCompleted: async (chainId, onNotification) => {
      return chainCompletedListener.subscribe((payload) => {
        if (payload === chainId) {
          onNotification();
        }
      });
    },

    notifyJobOwnershipLost: async (jobId) => {
      await provider.publish(ownershipLostChannel, jobId);
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
