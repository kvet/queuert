import { type NotifyAdapter } from "queuert";
import { createSharedListener } from "queuert/internal";

import { type RedisNotifyProvider } from "../notify-provider/notify-provider.redis.js";
import { CONSUME_WAKE_HINT_SCRIPT, PROVIDE_WAKE_HINT_SCRIPT } from "./lua.js";

/** Create a notify adapter backed by Redis pub/sub. */
export const createRedisNotifyAdapter = async ({
  notifyProvider,
  channelPrefix = "queuert",
}: {
  notifyProvider: RedisNotifyProvider;
  channelPrefix?: string;
}): Promise<NotifyAdapter> => {
  const jobScheduledChannel = `${channelPrefix}:sched`;
  const chainCompletedChannel = `${channelPrefix}:chainc`;
  const ownershipLostChannel = `${channelPrefix}:owls`;
  const hintKeyPrefix = `${channelPrefix}:hint:`;

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
  const ownershipLostListener = createSharedListener(async (dispatch) =>
    notifyProvider.subscribe(ownershipLostChannel, (payload) => {
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

    provideWakeHint: async (typeName, count) => {
      assertOpen();
      await notifyProvider.eval(
        PROVIDE_WAKE_HINT_SCRIPT,
        [`${hintKeyPrefix}${typeName}`],
        [String(count)],
      );
    },

    consumeWakeHint: async (typeName) => {
      assertOpen();
      const result = await notifyProvider.eval(
        CONSUME_WAKE_HINT_SCRIPT,
        [`${hintKeyPrefix}${typeName}`],
        [],
      );
      return result === 1;
    },

    notifyJobChainCompleted: async (chainId) => {
      assertOpen();
      await notifyProvider.publish(chainCompletedChannel, chainId);
    },

    listenJobChainCompleted: async (chainId, onNotification) => {
      assertOpen();
      return chainCompletedListener.subscribe(chainId, () => {
        onNotification();
      });
    },

    notifyJobOwnershipLost: async (jobId) => {
      assertOpen();
      await notifyProvider.publish(ownershipLostChannel, jobId);
    },

    listenJobOwnershipLost: async (jobId, onNotification) => {
      assertOpen();
      return ownershipLostListener.subscribe(jobId, () => {
        onNotification();
      });
    },

    close: async () => {
      if (closed) return;
      closed = true;
      await Promise.all([
        jobScheduledListener.dispose(),
        chainCompletedListener.dispose(),
        ownershipLostListener.dispose(),
      ]);
      await notifyProvider.close?.();
    },
  };
};
