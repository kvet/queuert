import type { NotifyAdapter } from "queuert";
import type { RedisNotifyProvider } from "../notify-provider/notify-provider.redis.js";
import { DECR_IF_POSITIVE_SCRIPT, SET_AND_PUBLISH_SCRIPT } from "./lua.js";

export type CreateRedisNotifyAdapterOptions<TContext> = {
  provider: RedisNotifyProvider<TContext>;
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

const createSharedListener = <TContext>(
  provider: RedisNotifyProvider<TContext>,
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

        const unsubscribe = (await provider.provideContext("subscribe", async (ctx) => {
          const unsub = await provider.subscribe(ctx, channel, (payload) => {
            if (state.status === "running") {
              for (const cb of state.callbacks) {
                cb(payload);
              }
            }
          });
          resolveReady();
          return unsub;
        })) as () => Promise<void>;

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

export const createRedisNotifyAdapter = async <TContext>({
  provider,
  channelPrefix = "queuert",
}: CreateRedisNotifyAdapterOptions<TContext>): Promise<NotifyAdapter> => {
  const jobScheduledChannel = `${channelPrefix}:sched`;
  const sequenceCompletedChannel = `${channelPrefix}:seqc`;
  const ownershipLostChannel = `${channelPrefix}:owls`;
  const hintKeyPrefix = `${channelPrefix}:hint:`;

  const jobScheduledListener = createSharedListener(provider, jobScheduledChannel);
  const sequenceCompletedListener = createSharedListener(provider, sequenceCompletedChannel);
  const ownershipLostListener = createSharedListener(provider, ownershipLostChannel);

  return {
    notifyJobScheduled: async (typeName, count) => {
      const hintId = crypto.randomUUID();
      const hintKey = `${hintKeyPrefix}${hintId}`;

      await provider.provideContext("command", async (ctx) => {
        await provider.eval(
          ctx,
          SET_AND_PUBLISH_SCRIPT,
          [hintKey, jobScheduledChannel],
          [String(count), `${hintId}:${typeName}`],
        );
      });
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
        void provider.provideContext("command", async (ctx) => {
          const result = await provider.eval(ctx, DECR_IF_POSITIVE_SCRIPT, [hintKey], []);
          if (result === 1) {
            onNotification(typeName);
          }
        });
      });
    },

    notifyJobSequenceCompleted: async (sequenceId) => {
      await provider.provideContext("command", async (ctx) => {
        await provider.publish(ctx, sequenceCompletedChannel, sequenceId);
      });
    },

    listenJobSequenceCompleted: async (sequenceId, onNotification) => {
      return sequenceCompletedListener.subscribe((payload) => {
        if (payload === sequenceId) {
          onNotification();
        }
      });
    },

    notifyJobOwnershipLost: async (jobId) => {
      await provider.provideContext("command", async (ctx) => {
        await provider.publish(ctx, ownershipLostChannel, jobId);
      });
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
