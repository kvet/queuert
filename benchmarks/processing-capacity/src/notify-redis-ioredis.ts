import { createRedisNotifyAdapter } from "@queuert/redis";
import { RedisContainer } from "@testcontainers/redis";
import { createIoredisNotifyProvider } from "example-notify-redis-ioredis/provider";
import { Redis } from "ioredis";
import { createInProcessStateAdapter } from "queuert";

import { parseConcurrency, printHeader, runBenchmark } from "./utils.js";

printHeader("PROCESSING CAPACITY — REDIS NOTIFY (ioredis)");

const concurrency = parseConcurrency();

const stateAdapter = await createInProcessStateAdapter();

console.log("\nStarting Redis container...");
const redisContainer = await new RedisContainer("redis:8").withExposedPorts(6379).start();

const redisUrl = redisContainer.getConnectionUrl();
const redis = new Redis(redisUrl);
const redisSubscription = new Redis(redisUrl);

const notifyProvider = createIoredisNotifyProvider({
  client: redis,
  subscribeClient: redisSubscription,
});

const notifyAdapter = await createRedisNotifyAdapter({ notifyProvider });
console.log("Redis ready.");

await runBenchmark({
  stateAdapter,
  notifyAdapter,
  withTransaction: stateAdapter.withTransaction,
  concurrency,
});

redis.disconnect();
redisSubscription.disconnect();
await redisContainer.stop();
