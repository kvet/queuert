import { type RedisNotifyProvider } from "@queuert/redis";
import { type RedisClient } from "bun";

export const createBunRedisNotifyProvider = ({
  client,
  subscribeClient,
}: {
  client: RedisClient;
  subscribeClient: RedisClient;
}): RedisNotifyProvider => ({
  subscribe: async (channel, onMessage) => {
    const listener = (message: string) => {
      onMessage(message);
    };
    await subscribeClient.subscribe(channel, listener);
    return async () => {
      await subscribeClient.unsubscribe(channel, listener);
    };
  },
  eval: async (script, keys, args) => {
    return client.send("EVAL", [script, String(keys.length), ...keys, ...args]);
  },
});
