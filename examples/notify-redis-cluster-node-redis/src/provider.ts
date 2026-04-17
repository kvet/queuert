import { type RedisNotifyProvider } from "@queuert/redis";
import { type RedisClusterType } from "redis";

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
