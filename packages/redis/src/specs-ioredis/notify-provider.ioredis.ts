import { type Redis } from "ioredis";

import { type RedisNotifyProvider } from "../notify-provider/notify-provider.redis.js";

export const createIoredisNotifyProvider = ({
  client,
  subscribeClient,
}: {
  client: Redis;
  subscribeClient: Redis;
}): RedisNotifyProvider => {
  const handlers = new Map<string, Set<(message: string) => void>>();

  subscribeClient.on("message", (channel: string, message: string) => {
    const listeners = handlers.get(channel);
    if (!listeners) return;
    for (const listener of listeners) listener(message);
  });

  return {
    publish: async (channel, message) => {
      await client.publish(channel, message);
    },
    subscribe: async (channel, onMessage) => {
      let listeners = handlers.get(channel);
      if (!listeners) {
        listeners = new Set();
        handlers.set(channel, listeners);
      }
      listeners.add(onMessage);
      await subscribeClient.subscribe(channel);
      return async () => {
        const set = handlers.get(channel);
        if (!set) return;
        set.delete(onMessage);
        if (set.size === 0) {
          handlers.delete(channel);
          await subscribeClient.unsubscribe(channel);
        }
      };
    },
    eval: async (script, keys, args) => {
      return client.eval(script, keys.length, ...keys, ...args);
    },
  };
};
