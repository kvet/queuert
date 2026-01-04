import { RedisClientType } from "redis";
import type { RedisNotifyProvider } from "../notify-provider/notify-provider.redis.js";

export type RedisContext = { client: RedisClientType };

export const createNodeRedisNotifyProvider = ({
  client,
  subscribeClient,
  brpopClient,
}: {
  client: RedisClientType;
  subscribeClient: RedisClientType;
  brpopClient?: RedisClientType;
}): RedisNotifyProvider<{ client: RedisClientType }> => ({
  provideContext: async (type, fn) => {
    if (type === "command") {
      return fn({ client });
    }
    if (type === "subscribe") {
      return fn({ client: subscribeClient });
    }
    if (type === "brpop" && brpopClient) {
      return fn({ client: brpopClient });
    } else if (type === "brpop") {
      const createdBrpopClient = client.duplicate();
      await createdBrpopClient.connect();
      try {
        return await fn({ client: createdBrpopClient });
      } finally {
        await createdBrpopClient.close();
      }
    }
    throw new Error(`Unknown context type: ${type}`);
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
  lpush: async ({ client }, queue, message) => {
    await client.lPush(queue, message);
  },
  brpop: async ({ client }, queues, timeoutMs) => {
    const result = await client.brPop(queues, timeoutMs / 1000);
    return result ? { queue: result.key, message: result.element } : undefined;
  },
});
