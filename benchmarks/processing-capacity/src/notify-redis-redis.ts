import { createRedisNotifyAdapter } from "@queuert/redis";
import { createNodeRedisNotifyProvider } from "example-notify-redis-redis/provider";
import { createInProcessStateAdapter } from "queuert";
import { type RedisClientType, createClient as createRedisClient } from "redis";

import { benchmarkNamespace, requireEnv, runBenchmark } from "./utils.js";

const redisUrl = requireEnv("BENCHMARK_REDIS_URL");
const redis = createRedisClient({ url: redisUrl }) as RedisClientType;
const redisSubscription = createRedisClient({ url: redisUrl }) as RedisClientType;
await redis.connect();
await redisSubscription.connect();

await runBenchmark({
  title: "PROCESSING CAPACITY — REDIS NOTIFY (redis)",
  stateAdapter: createInProcessStateAdapter(),
  notifyAdapter: createRedisNotifyAdapter({
    notifyProvider: createNodeRedisNotifyProvider({
      client: redis,
      subscribeClient: redisSubscription,
    }),
    channelPrefix: benchmarkNamespace(),
  }),
});

await redis.quit();
await redisSubscription.quit();
