import { createRedisNotifyAdapter } from "@queuert/redis";
import { RedisContainer } from "@testcontainers/redis";
import { createIoredisNotifyProvider } from "example-notify-redis-ioredis/provider";
import { Redis } from "ioredis";
import { createInProcessStateAdapter } from "queuert";

import { runBenchmark } from "./utils.js";

console.log("\nStarting Redis container...");
const redisContainer = await new RedisContainer("redis:8").withExposedPorts(6379).start();

const redisUrl = redisContainer.getConnectionUrl();
const redis = new Redis(redisUrl);
const redisSubscription = new Redis(redisUrl);
console.log("Redis ready.");

await runBenchmark({
  title: "PROCESSING CAPACITY — REDIS NOTIFY (ioredis)",
  stateAdapter: await createInProcessStateAdapter(),
  notifyAdapter: await createRedisNotifyAdapter({
    notifyProvider: createIoredisNotifyProvider({
      client: redis,
      subscribeClient: redisSubscription,
    }),
  }),
});

redis.disconnect();
redisSubscription.disconnect();
await redisContainer.stop();
