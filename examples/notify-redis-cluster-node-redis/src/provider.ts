import { type RedisNotifyProvider } from "@queuert/redis";
import { type RedisClusterType } from "redis";

export const createNodeRedisClusterNotifyProvider = ({
  cluster,
  subscribeCluster,
}: {
  cluster: RedisClusterType;
  subscribeCluster: RedisClusterType;
}): RedisNotifyProvider => {
  // node-redis cluster tears down its shared pub/sub socket on
  // last-unsubscribe, which crashes with "The client is closed" when another
  // subscribe/unsubscribe is in flight. Serialize to prevent that.
  let chain: Promise<unknown> = Promise.resolve();
  const run = async <R>(fn: () => Promise<R>): Promise<R> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  };

  return {
    publish: async (channel, message) => {
      await cluster.publish(channel, message);
    },
    subscribe: async (channel, onMessage) => {
      await run(async () => subscribeCluster.subscribe(channel, onMessage));
      return async () => {
        await run(async () => subscribeCluster.unsubscribe(channel));
      };
    },
    eval: async (script, keys, args) => {
      return cluster.eval(script, { keys, arguments: args });
    },
  };
};
