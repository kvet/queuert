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
}): NotifyAdapter => {
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
      await notifyProvider.eval(PUBLISH_MESSAGES_SCRIPT, [], [chainCompletedChannel, ...chainIds]);
    },

    listenChainCompleted: async (chainId, onNotification) => {
      closed.throwIfTripped();
      return chainCompletedListener.subscribe(chainId, () => {
        onNotification();
      });
    },

    notifyJobAttemptsLost: async (jobIds) => {
      closed.throwIfTripped();
      await notifyProvider.eval(PUBLISH_MESSAGES_SCRIPT, [], [attemptLostChannel, ...jobIds]);
    },

    listenJobAttemptLost: async (jobId, onNotification) => {
      closed.throwIfTripped();
      return attemptLostListener.subscribe(jobId, () => {
        onNotification();
      });
    },

    close,
    [Symbol.asyncDispose]: close,
  };
};
