import { RedisClientType } from "redis";
import type { RedisNotifyProvider } from "../notify-provider/notify-provider.redis.js";

export type RedisContext = { client: RedisClientType };

export const createNodeRedisNotifyProvider = ({
  client,
  subscribeClient,
}: {
  client: RedisClientType;
  subscribeClient: RedisClientType;
}): RedisNotifyProvider<{ client: RedisClientType }> => ({
  provideContext: async (type, fn) => {
    switch (type) {
      case "command":
        return fn({ client });
      case "subscribe":
        return fn({ client: subscribeClient });
    }
  },
  publish: async ({ client }, channel, message) => {
    await client.publish(channel, message);
  },
  subscribe: async ({ client }, channel, onMessage) => {
    await client.subscribe(channel, onMessage);
    return async () => {
      await client.unsubscribe(channel);
    };
  },
  eval: async ({ client }, script, keys, args) => {
    return client.eval(script, { keys, arguments: args });
  },
});
