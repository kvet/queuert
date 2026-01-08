import type { NotifyAdapter } from "queuert";
import type { PgNotifyProvider } from "../notify-provider/notify-provider.pg.js";

type SharedListenerState =
  | { status: "idle" }
  | { status: "starting"; readyPromise: Promise<void> }
  | {
      status: "running";
      callbacks: Set<(payload: string) => void>;
      unsubscribe: () => Promise<void>;
      signalClose: () => void;
      connectionPromise: Promise<void>;
    }
  | { status: "stopping"; stoppedPromise: Promise<void> };

const createSharedListener = <TContext>(
  provider: PgNotifyProvider<TContext>,
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
        const { promise: closeSignal, resolve: signalClose } = Promise.withResolvers<void>();

        state = { status: "starting", readyPromise };

        let unsubscribe: () => Promise<void>;
        const connectionPromise = provider.provideContext("listen", async (ctx) => {
          unsubscribe = await provider.subscribe(ctx, channel, (payload) => {
            if (state.status === "running") {
              for (const cb of state.callbacks) {
                cb(payload);
              }
            }
          });

          resolveReady();
          await closeSignal;
          await unsubscribe();
        }) as Promise<void>;

        await readyPromise;
        state = {
          status: "running",
          callbacks,
          unsubscribe: unsubscribe!,
          signalClose,
          connectionPromise,
        };
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

    const { signalClose, connectionPromise } = state;
    state = { status: "stopping", stoppedPromise: connectionPromise };

    signalClose();
    await connectionPromise;

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

export const createPgNotifyAdapter = async <TContext>({
  provider,
  channelPrefix = "queuert",
}: {
  provider: PgNotifyProvider<TContext>;
  channelPrefix?: string;
}): Promise<NotifyAdapter> => {
  const jobScheduledChannel = `${channelPrefix}_sched`;
  const sequenceCompletedChannel = `${channelPrefix}_seqc`;
  const ownershipLostChannel = `${channelPrefix}_owls`;

  const jobScheduledListener = createSharedListener(provider, jobScheduledChannel);
  const sequenceCompletedListener = createSharedListener(provider, sequenceCompletedChannel);
  const ownershipLostListener = createSharedListener(provider, ownershipLostChannel);

  return {
    notifyJobScheduled: async (typeName, _count) => {
      await provider.provideContext("query", async (ctx) => {
        await provider.publish(ctx, jobScheduledChannel, typeName);
      });
    },

    listenJobScheduled: async (typeNames, onNotification) => {
      const typeNameSet = new Set(typeNames);
      return jobScheduledListener.subscribe((payload) => {
        if (typeNameSet.has(payload)) {
          onNotification(payload);
        }
      });
    },

    notifyJobSequenceCompleted: async (sequenceId) => {
      await provider.provideContext("query", async (ctx) => {
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
      await provider.provideContext("query", async (ctx) => {
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
