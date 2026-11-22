import { createLatch } from "@queuert/helpers/latch";
import { createSharedListener } from "@queuert/helpers/shared-listener";
import type { NotifyAdapter } from "queuert";

import type { RedisNotifyProvider } from "../notify-provider/notify-provider.redis.ts";
import { PUBLISH_MESSAGES_SCRIPT } from "./lua.ts";

/**
 * Create a notify adapter backed by Redis pub/sub.
 *
 * @param options - Redis notify adapter configuration.
 */
export const createRedisNotifyAdapter = ({
  notifyProvider,
  channelPrefix = "queuert",
}: {
  /** Redis notify provider wrapping the pub/sub client. */
  notifyProvider: RedisNotifyProvider;
  /** Prefix for all pub/sub channel names. @defaultValue `"queuert"` */
  channelPrefix?: string;
}): NotifyAdapter<"async"> => {
  const jobScheduledChannel = `${channelPrefix}:sched`;
  const chainCompletedChannel = `${channelPrefix}:chainc`;
  const attemptLostChannel = `${channelPrefix}:atls`;

  const jobScheduledListener = createSharedListener(async (dispatch) =>
    notifyProvider.subscribe(jobScheduledChannel, (payload) => {
      dispatch(payload);
    }),
  );
  const chainCompletedListener = createSharedListener(async (dispatch) =>
    notifyProvider.subscribe(chainCompletedChannel, (payload) => {
      dispatch(payload);
    }),
  );
  const attemptLostListener = createSharedListener(async (dispatch) =>
    notifyProvider.subscribe(attemptLostChannel, (payload) => {
      dispatch(payload);
    }),
  );

  const closed = createLatch("NotifyAdapter is closed");

  const close = async (): Promise<void> => {
    if (!closed.trip()) return;
    await Promise.all([
      jobScheduledListener.dispose(),
      chainCompletedListener.dispose(),
      attemptLostListener.dispose(),
    ]);
    await notifyProvider.close?.();
  };

  return {
    notifyJobsScheduled: async (typeNames) => {
      closed.throwIfTripped();
      await notifyProvider.eval(PUBLISH_MESSAGES_SCRIPT, [], [jobScheduledChannel, ...typeNames]);
    },

    listenJobsScheduled: async (typeNames, onNotification) => {
      closed.throwIfTripped();
      return jobScheduledListener.subscribe(typeNames, (typeName) => {
        onNotification(typeName);
      });
    },

    notifyChainsCompleted: async (chainIds) => {
      closed.throwIfTripped();
      await notifyProvider.eval(PUBLISH_MESSAGES_SCRIPT, [], [chainCompletedChannel, ...chainIds]);
    },

    listenChainsCompleted: async (chainIds, onNotification) => {
      closed.throwIfTripped();
      return chainCompletedListener.subscribe(chainIds, (chainId) => {
        onNotification(chainId);
      });
    },

    notifyJobAttemptsLost: async (jobIds) => {
      closed.throwIfTripped();
      await notifyProvider.eval(PUBLISH_MESSAGES_SCRIPT, [], [attemptLostChannel, ...jobIds]);
    },

    listenJobAttemptsLost: async (jobIds, onNotification) => {
      closed.throwIfTripped();
      return attemptLostListener.subscribe(jobIds, (jobId) => {
        onNotification(jobId);
      });
    },

    close,
    [Symbol.asyncDispose]: close,
  };
};
