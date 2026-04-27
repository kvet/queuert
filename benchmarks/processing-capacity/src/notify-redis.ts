import { createRedisNotifyAdapter } from "@queuert/redis";
import { RedisContainer } from "@testcontainers/redis";
import { createNodeRedisNotifyProvider } from "example-notify-redis-redis/provider";
import { createInProcessStateAdapter } from "queuert";
import { type RedisClientType, createClient as createRedisClient } from "redis";

import { parseConcurrency, printHeader, runBenchmark } from "./utils.js";

printHeader("PROCESSING CAPACITY — REDIS NOTIFY");

const concurrency = parseConcurrency();

const stateAdapter = await createInProcessStateAdapter();

console.log("\nStarting Redis container...");
const redisContainer = await new RedisContainer("redis:8").withExposedPorts(6379).start();

const redisUrl = redisContainer.getConnectionUrl();
const redis = createRedisClient({ url: redisUrl }) as RedisClientType;
const redisSubscription = createRedisClient({ url: redisUrl }) as RedisClientType;
await redis.connect();
await redisSubscription.connect();

const notifyProvider = createNodeRedisNotifyProvider({
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

await redis.quit();
await redisSubscription.quit();
await redisContainer.stop();
