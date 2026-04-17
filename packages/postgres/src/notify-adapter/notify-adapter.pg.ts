import { type NotifyAdapter } from "queuert";

import { type PgNotifyProvider } from "../notify-provider/notify-provider.pg.js";

type SharedListenerState =
  | { status: "idle" }
  | { status: "starting"; readyPromise: Promise<void> }
  | {
      status: "running";
      callbacks: Set<(payload: string) => void>;
      unsubscribe: () => Promise<void>;
    }
  | { status: "stopping"; stoppedPromise: Promise<void> };

/**
 * Multiplexes many application-level listeners onto a single Postgres LISTEN
 * per channel. Opens the underlying subscription lazily on first listener,
 * reuses it for all subsequent listeners, and tears it down (UNLISTEN) when
 * the last listener unsubscribes. The returned `subscribe` resolves with an
 * unsubscribe function scoped to that one callback.
 */
const createSharedListener = (
  provider: PgNotifyProvider,
  channel: string,
): {
  subscribe: (callback: (payload: string) => void) => Promise<() => Promise<void>>;
} => {
  let state: SharedListenerState = { status: "idle" };

  /**
   * Returns the callback set for the running subscription, opening it if
   * needed. Concurrent callers either win the idle→starting transition and
   * open the subscription, or wait on an in-flight `starting`/`stopping`
   * transition and retry — so only one `provider.subscribe` is ever in
   * flight at a time for this channel.
   */
  const ensureRunning = async (): Promise<Set<(payload: string) => void>> => {
    while (true) {
      if (state.status === "idle") {
        const callbacks = new Set<(payload: string) => void>();
        const { promise: readyPromise, resolve: resolveReady } = Promise.withResolvers<void>();

        state = { status: "starting", readyPromise };

        const unsubscribe = await provider.subscribe(channel, (payload) => {
          if (state.status === "running") {
            for (const callback of state.callbacks) {
              callback(payload);
            }
          }
        });

        resolveReady();
        state = {
          status: "running",
          callbacks,
          unsubscribe,
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

  /**
   * Tears down the subscription when the last listener leaves. No-op if
   * other listeners remain, or if we're mid-transition (`ensureRunning`
   * handles the race).
   */
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

/** Create a notify adapter backed by PostgreSQL LISTEN/NOTIFY. */
export const createPgNotifyAdapter = async ({
  notifyProvider,
  channelPrefix = "queuert",
}: {
  notifyProvider: PgNotifyProvider;
  channelPrefix?: string;
}): Promise<NotifyAdapter> => {
  const jobScheduledChannel = `${channelPrefix}_sched`;
  const chainCompletedChannel = `${channelPrefix}_chainc`;
  const ownershipLostChannel = `${channelPrefix}_owls`;

  const jobScheduledListener = createSharedListener(notifyProvider, jobScheduledChannel);
  const chainCompletedListener = createSharedListener(notifyProvider, chainCompletedChannel);
  const ownershipLostListener = createSharedListener(notifyProvider, ownershipLostChannel);

  return {
    notifyJobScheduled: async (typeName, _count) => {
      await notifyProvider.publish(jobScheduledChannel, typeName);
    },

    listenJobScheduled: async (typeNames, onNotification) => {
      const typeNameSet = new Set(typeNames);
      return jobScheduledListener.subscribe((payload) => {
        if (typeNameSet.has(payload)) {
          onNotification(payload);
        }
      });
    },

    notifyJobChainCompleted: async (chainId) => {
      await notifyProvider.publish(chainCompletedChannel, chainId);
    },

    listenJobChainCompleted: async (chainId, onNotification) => {
      return chainCompletedListener.subscribe((payload) => {
        if (payload === chainId) {
          onNotification();
        }
      });
    },

    notifyJobOwnershipLost: async (jobId) => {
      await notifyProvider.publish(ownershipLostChannel, jobId);
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
