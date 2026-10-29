import { type RedisNotifyProvider } from "@queuert/redis";
import { type RedisClusterType } from "redis";

export const createNodeRedisClusterNotifyProvider = ({
  cluster,
  subscribeCluster,
}: {
  cluster: RedisClusterType;
  subscribeCluster: RedisClusterType;
}): RedisNotifyProvider => {
  // Workaround for duplicate deliveries. Redis Cluster forwards PUBLISH to every node over the
  // cluster bus, but Redis does not set TCP_NODELAY on the bus connections a node opens, so
  // back-to-back messages can reach some nodes ~40ms late (Nagle + delayed ACK; fixed in Valkey by
  // https://github.com/valkey-io/valkey/pull/1763, still present in Redis 8). node-redis closes its
  // pub/sub connection when the last channel is unsubscribed and reopens it on a random node, so a
  // resubscribe can land on a node that delivers a late copy of a message already received. A
  // subscription that is never removed keeps the connection, and its node, for the provider's
  // lifetime.
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
