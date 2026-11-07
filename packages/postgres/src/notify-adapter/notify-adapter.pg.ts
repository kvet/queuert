import { createSharedListener, createLatch } from "@queuert/helpers";
import type { NotifyAdapter } from "queuert";

import type { PgNotifyProvider } from "../notify-provider/notify-provider.pg.ts";

/**
 * Create a notify adapter backed by PostgreSQL LISTEN/NOTIFY.
 *
 * @param options - PostgreSQL notify adapter configuration.
 */
export const createPgNotifyAdapter = ({
  notifyProvider,
  channelPrefix = "queuert",
}: {
  /** PostgreSQL notify provider wrapping the LISTEN/NOTIFY connection. */
  notifyProvider: PgNotifyProvider;
  /** Prefix for all LISTEN/NOTIFY channel names. @defaultValue `"queuert"` */
  channelPrefix?: string;
}): NotifyAdapter => {
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

  const closed = createLatch("NotifyAdapter is closed");

  return {
    notifyJobsScheduled: async (typeNames) => {
      closed.throwIfTripped();
      await notifyProvider.publish(jobScheduledChannel, typeNames);
    },

    listenJobScheduled: async (typeNames, onNotification) => {
      closed.throwIfTripped();
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

    notifyChainsCompleted: async (chainIds) => {
      closed.throwIfTripped();
      await notifyProvider.publish(chainCompletedChannel, chainIds);
    },

    listenChainCompleted: async (chainId, onNotification) => {
      closed.throwIfTripped();
      return chainCompletedListener.subscribe(chainId, () => {
        onNotification();
      });
    },

    notifyJobAttemptsLost: async (jobIds) => {
      closed.throwIfTripped();
      await notifyProvider.publish(attemptLostChannel, jobIds);
    },

    listenJobAttemptLost: async (jobId, onNotification) => {
      closed.throwIfTripped();
      return attemptLostListener.subscribe(jobId, () => {
        onNotification();
      });
    },

    close: async () => {
      if (!closed.trip()) return;
      await Promise.all([
        jobScheduledListener.dispose(),
        chainCompletedListener.dispose(),
        attemptLostListener.dispose(),
      ]);
      await notifyProvider.close?.();
    },
  };
};
