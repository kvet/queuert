import { createRedisNotifyAdapter } from "@queuert/redis";
import { createIoredisNotifyProvider } from "example-notify-redis-ioredis/provider";
import { Redis } from "ioredis";
import { createInProcessStateAdapter } from "queuert";

import { benchmarkNamespace, requireEnv, runBenchmark } from "./utils.js";

const redisUrl = requireEnv("BENCHMARK_REDIS_URL");
const redis = new Redis(redisUrl);
const redisSubscription = new Redis(redisUrl);
await runBenchmark({
  title: "PROCESSING CAPACITY — REDIS NOTIFY (ioredis)",
  stateAdapter: createInProcessStateAdapter(),
  notifyAdapter: createRedisNotifyAdapter({
    notifyProvider: createIoredisNotifyProvider({
      client: redis,
      subscribeClient: redisSubscription,
    }),
    channelPrefix: benchmarkNamespace(),
  }),
});

redis.disconnect();
redisSubscription.disconnect();
