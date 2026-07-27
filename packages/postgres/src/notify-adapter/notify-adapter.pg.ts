import { type NotifyAdapter } from "queuert";
import { createSharedListener } from "queuert/internal";

import { type PgNotifyProvider } from "../notify-provider/notify-provider.pg.js";

/**
 * Create a notify adapter backed by PostgreSQL LISTEN/NOTIFY.
 *
 * PostgreSQL has no native counter primitive suitable for atomic wake-fan-out
 * gating, so `provideWakeHint`/`consumeWakeHint` are no-ops here — every
 * listener wakes on every notification, and the database handles contention.
 *
 * @param options - PostgreSQL notify adapter configuration.
 */
export const createPgNotifyAdapter = async ({
  notifyProvider,
  channelPrefix = "queuert",
}: {
  /** PostgreSQL notify provider wrapping the LISTEN/NOTIFY connection. */
  notifyProvider: PgNotifyProvider;
  /** Prefix for all LISTEN/NOTIFY channel names. @defaultValue `"queuert"` */
  channelPrefix?: string;
}): Promise<NotifyAdapter> => {
  const jobScheduledChannel = `${channelPrefix}_sched`;
  const chainCompletedChannel = `${channelPrefix}_chainc`;
  const attemptLostChannel = `${channelPrefix}_atls`;

  const jobScheduledListener = createSharedListener(async (dispatch) =>
    notifyProvider.subscribe(jobScheduledChannel, (payload) => {
      dispatch(payload, payload);
    }),
  );
  const chainCompletedListener = createSharedListener(async (dispatch) =>
    notifyProvider.subscribe(chainCompletedChannel, (payload) => {
      dispatch(payload, payload);
    }),
  );
  const attemptLostListener = createSharedListener(async (dispatch) =>
    notifyProvider.subscribe(attemptLostChannel, (payload) => {
      dispatch(payload, payload);
    }),
  );

  let closed = false;
  const assertOpen = (): void => {
    if (closed) throw new Error("NotifyAdapter is closed");
  };

  return {
    notifyJobScheduled: async (typeName) => {
      assertOpen();
      await notifyProvider.publish(jobScheduledChannel, typeName);
    },

    listenJobScheduled: async (typeNames, onNotification) => {
      assertOpen();
      const unsubs = await Promise.all(
        typeNames.map(async (typeName) =>
          jobScheduledListener.subscribe(typeName, () => {
            onNotification(typeName);
          }),
        ),
      );
      return async () => {
        await Promise.all(unsubs.map(async (u) => u()));
      };
    },

    provideWakeHint: async () => {},
    consumeWakeHint: async () => true,

    notifyChainCompleted: async (chainId) => {
      assertOpen();
      await notifyProvider.publish(chainCompletedChannel, chainId);
    },

    listenChainCompleted: async (chainId, onNotification) => {
      assertOpen();
      return chainCompletedListener.subscribe(chainId, () => {
        onNotification();
      });
    },

    notifyJobAttemptLost: async (jobId) => {
      assertOpen();
      await notifyProvider.publish(attemptLostChannel, jobId);
    },

    listenJobAttemptLost: async (jobId, onNotification) => {
      assertOpen();
      return attemptLostListener.subscribe(jobId, () => {
        onNotification();
      });
    },

    close: async () => {
      if (closed) return;
      closed = true;
      await Promise.all([
        jobScheduledListener.dispose(),
        chainCompletedListener.dispose(),
        attemptLostListener.dispose(),
      ]);
      await notifyProvider.close?.();
    },
  };
};
