import { createRedisStateAdapter } from "@queuert/redis";
import { createNodeRedisStateProvider } from "example-state-redis-redis/provider";
import { Redis } from "ioredis";
import { type RedisClientType, createClient as createRedisClient } from "redis";

import { createRedisServerStats } from "./redis-server-stats.ts";
import { benchmarkNamespace, noopNotifyAdapter, requireEnv, runBenchmark } from "./utils.ts";

const redisUrl = requireEnv("BENCHMARK_REDIS_URL");
const redis = createRedisClient({ url: redisUrl }) as RedisClientType;
await redis.connect();
const statsClient = new Redis(redisUrl);

const stateAdapter = createRedisStateAdapter({
  stateProvider: createNodeRedisStateProvider({ client: redis }),
  keyPrefix: `{${benchmarkNamespace()}}:`,
});
await stateAdapter.migrateToLatest();

await runBenchmark({
  title: "PROCESSING CAPACITY — REDIS (redis)",
  stateAdapter,
  notifyAdapter: noopNotifyAdapter,
  serverStats: createRedisServerStats(statsClient),
});

await redis.quit();
statsClient.disconnect();
