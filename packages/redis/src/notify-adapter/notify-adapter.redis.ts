import { createSharedListener } from "@queuert/helpers";
import { type NotifyAdapter } from "queuert";

import { type RedisNotifyProvider } from "../notify-provider/notify-provider.redis.js";
import { PUBLISH_MESSAGES_SCRIPT } from "./lua.js";

/**
 * Create a notify adapter backed by Redis pub/sub.
 *
 * @param options - Redis notify adapter configuration.
 */
export const createRedisNotifyAdapter = async ({
  notifyProvider,
  channelPrefix = "queuert",
}: {
  /** Redis notify provider wrapping the pub/sub client. */
  notifyProvider: RedisNotifyProvider;
  /** Prefix for all pub/sub channel names. @defaultValue `"queuert"` */
  channelPrefix?: string;
}): Promise<NotifyAdapter> => {
  const jobScheduledChannel = `${channelPrefix}:sched`;
  const chainCompletedChannel = `${channelPrefix}:chainc`;
  const attemptLostChannel = `${channelPrefix}:atls`;

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
    notifyJobsScheduled: async (typeNames) => {
      assertOpen();
      await notifyProvider.eval(PUBLISH_MESSAGES_SCRIPT, [], [jobScheduledChannel, ...typeNames]);
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

    notifyChainsCompleted: async (chainIds) => {
      assertOpen();
      await notifyProvider.eval(PUBLISH_MESSAGES_SCRIPT, [], [chainCompletedChannel, ...chainIds]);
    },

    listenChainCompleted: async (chainId, onNotification) => {
      assertOpen();
      return chainCompletedListener.subscribe(chainId, () => {
        onNotification();
      });
    },

    notifyJobAttemptsLost: async (jobIds) => {
      assertOpen();
      await notifyProvider.eval(PUBLISH_MESSAGES_SCRIPT, [], [attemptLostChannel, ...jobIds]);
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
