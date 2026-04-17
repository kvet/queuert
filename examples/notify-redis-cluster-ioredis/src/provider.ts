import { type RedisNotifyProvider } from "@queuert/redis";
import { type Cluster } from "ioredis";

export const createIoredisClusterNotifyProvider = ({
  cluster,
  subscribeCluster,
}: {
  cluster: Cluster;
  subscribeCluster: Cluster;
}): RedisNotifyProvider => {
  const handlers = new Map<string, Set<(message: string) => void>>();

  subscribeCluster.on("message", (channel: string, message: string) => {
    const listeners = handlers.get(channel);
    if (!listeners) return;
    for (const listener of listeners) listener(message);
  });

  return {
    publish: async (channel, message) => {
      await cluster.publish(channel, message);
    },
    subscribe: async (channel, onMessage) => {
      let listeners = handlers.get(channel);
      if (!listeners) {
        listeners = new Set();
        handlers.set(channel, listeners);
      }
      listeners.add(onMessage);
      await subscribeCluster.subscribe(channel);
      return async () => {
        const set = handlers.get(channel);
        if (!set) return;
        set.delete(onMessage);
        if (set.size === 0) {
          handlers.delete(channel);
          await subscribeCluster.unsubscribe(channel);
        }
      };
    },
    eval: async (script, keys, args) => {
      return cluster.eval(script, keys.length, ...keys, ...args);
    },
  };
};
