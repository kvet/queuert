import { type RedisNotifyProvider } from "@queuert/redis";
import { type Redis } from "ioredis";

export const createIoredisNotifyProvider = ({
  client,
  subscribeClient,
}: {
  client: Redis;
  subscribeClient: Redis;
}): RedisNotifyProvider => {
  const handlers = new Map<string, (message: string) => void>();

  subscribeClient.on("message", (channel: string, message: string) => {
    handlers.get(channel)?.(message);
  });

  return {
    publish: async (channel, message) => {
      await client.publish(channel, message);
    },
    subscribe: async (channel, onMessage) => {
      handlers.set(channel, onMessage);
      await subscribeClient.subscribe(channel);
      return async () => {
        await subscribeClient.unsubscribe(channel);
        handlers.delete(channel);
      };
    },
    eval: async (script, keys, args) => {
      return client.eval(script, keys.length, ...keys, ...args);
    },
  };
};
