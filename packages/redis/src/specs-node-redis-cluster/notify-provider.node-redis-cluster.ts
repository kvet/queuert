import { type RedisClusterType } from "redis";

import { type RedisNotifyProvider } from "../notify-provider/notify-provider.redis.js";

export const createNodeRedisClusterNotifyProvider = ({
  cluster,
  subscribeCluster,
}: {
  cluster: RedisClusterType;
  subscribeCluster: RedisClusterType;
}): RedisNotifyProvider => ({
  publish: async (channel, message) => {
    await cluster.publish(channel, message);
  },
  subscribe: async (channel, onMessage) => {
    await subscribeCluster.subscribe(channel, onMessage);
    return async () => {
      await subscribeCluster.unsubscribe(channel);
    };
  },
  eval: async (script, keys, args) => {
    return cluster.eval(script, { keys, arguments: args });
  },
});
