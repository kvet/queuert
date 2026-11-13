import { createRedisStateAdapter } from "@queuert/redis";
import { createIoredisStateProvider } from "example-state-redis-ioredis/provider";
import { Redis } from "ioredis";

import { createRedisServerStats } from "./redis-server-stats.ts";
import { benchmarkNamespace, noopNotifyAdapter, requireEnv, runBenchmark } from "./utils.ts";

const redisUrl = requireEnv("BENCHMARK_REDIS_URL");
const redis = new Redis(redisUrl);
const statsClient = new Redis(redisUrl);

const stateAdapter = createRedisStateAdapter({
  stateProvider: createIoredisStateProvider({ client: redis }),
  keyPrefix: `{${benchmarkNamespace()}}:`,
});
await stateAdapter.migrateToLatest();

await runBenchmark({
  title: "PROCESSING CAPACITY — REDIS (ioredis)",
  stateAdapter,
  notifyAdapter: noopNotifyAdapter,
  serverStats: createRedisServerStats(statsClient),
});

redis.disconnect();
statsClient.disconnect();
