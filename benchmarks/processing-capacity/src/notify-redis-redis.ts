import { createRedisNotifyAdapter } from "@queuert/redis";
import { RedisContainer } from "@testcontainers/redis";
import { createNodeRedisNotifyProvider } from "example-notify-redis-redis/provider";
import { createInProcessStateAdapter } from "queuert";
import { type RedisClientType, createClient as createRedisClient } from "redis";

import { runBenchmark } from "./utils.js";

console.log("\nStarting Redis container...");
const redisContainer = await new RedisContainer("redis:8").withExposedPorts(6379).start();

const redisUrl = redisContainer.getConnectionUrl();
const redis = createRedisClient({ url: redisUrl }) as RedisClientType;
const redisSubscription = createRedisClient({ url: redisUrl }) as RedisClientType;
await redis.connect();
await redisSubscription.connect();

console.log("Redis ready.");

await runBenchmark({
  title: "PROCESSING CAPACITY — REDIS NOTIFY (redis)",
  stateAdapter: await createInProcessStateAdapter(),
  notifyAdapter: await createRedisNotifyAdapter({
    notifyProvider: createNodeRedisNotifyProvider({
      client: redis,
      subscribeClient: redisSubscription,
    }),
  }),
});

await redis.quit();
await redisSubscription.quit();
await redisContainer.stop();
