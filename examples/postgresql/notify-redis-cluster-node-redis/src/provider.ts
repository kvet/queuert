import type { RedisNotifyProvider } from "@queuert/redis";
import type { RedisClusterType } from "redis";

export const createNodeRedisClusterNotifyProvider = ({
  cluster,
  subscribeCluster,
}: {
  cluster: RedisClusterType;
  subscribeCluster: RedisClusterType;
}): RedisNotifyProvider => {
  const pinChannel = "queuert:pubsub-pin";
  const pinListener = (): void => {};
  let pinned: Promise<void> | undefined;
  const pinPubSubConnection = async (): Promise<void> => {
    pinned ??= subscribeCluster.subscribe(pinChannel, pinListener).catch((error: unknown) => {
      pinned = undefined;
      throw error;
    });
    await pinned;
  };

  return {
    subscribe: async (channel, onMessage) => {
      await pinPubSubConnection();
      await subscribeCluster.subscribe(channel, onMessage);
      return async () => {
        await subscribeCluster.unsubscribe(channel);
      };
    },
    eval: async (script, keys, args) => {
      return cluster.eval(script, { keys, arguments: args });
    },
    close: async () => {
      if (!pinned) return;
      const pin = pinned;
      pinned = undefined;
      const wasPinned = await pin.then(
        () => true,
        () => false,
      );
      if (wasPinned) await subscribeCluster.unsubscribe(pinChannel, pinListener);
    },
  };
};
