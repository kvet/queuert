import { type RedisClientType } from "redis";
import { type RedisNotifyProvider } from "../notify-provider/notify-provider.redis.js";

export const createNodeRedisNotifyProvider = ({
  client,
  subscribeClient,
}: {
  client: RedisClientType;
  subscribeClient: RedisClientType;
}): RedisNotifyProvider => ({
  publish: async (channel, message) => {
    await client.publish(channel, message);
  },
  subscribe: async (channel, onMessage) => {
    await subscribeClient.subscribe(channel, onMessage);
    return async () => {
      await subscribeClient.unsubscribe(channel);
    };
  },
  eval: async (script, keys, args) => {
    return client.eval(script, { keys, arguments: args });
  },
});
