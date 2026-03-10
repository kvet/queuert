import { createSqliteStateAdapter } from "@queuert/sqlite";
import { type RedisNotifyProvider, createRedisNotifyAdapter } from "@queuert/redis";
import { RedisContainer } from "@testcontainers/redis";
import Database from "better-sqlite3";
import { createClient as createRedisClient } from "redis";
import { createSqliteStateProvider } from "./sqlite-state-provider.js";
import { parseConcurrency, printHeader, runBenchmark } from "./utils.js";

printHeader("PROCESSING CAPACITY — REDIS NOTIFY");

const concurrency = parseConcurrency();

const db = new Database(":memory:");
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");

const stateProvider = createSqliteStateProvider(db);
const stateAdapter = await createSqliteStateAdapter({ stateProvider });
await stateAdapter.migrateToLatest();

console.log("\nStarting Redis container...");
const redisContainer = await new RedisContainer("redis:8").withExposedPorts(6379).start();

const redisUrl = redisContainer.getConnectionUrl();
const redis = createRedisClient({ url: redisUrl });
const redisSubscription = createRedisClient({ url: redisUrl });
await redis.connect();
await redisSubscription.connect();

const notifyProvider: RedisNotifyProvider = {
  publish: async (channel, message) => {
    await redis.publish(channel, message);
  },
  subscribe: async (channel, onMessage) => {
    await redisSubscription.subscribe(channel, onMessage);
    return async () => {
      await redisSubscription.unsubscribe(channel);
    };
  },
  eval: async (script, keys, args) => {
    return redis.eval(script, { keys, arguments: args });
  },
};

const notifyAdapter = await createRedisNotifyAdapter({ provider: notifyProvider });
console.log("SQLite + Redis ready.");

await runBenchmark({
  stateAdapter,
  notifyAdapter,
  runInTransaction: stateProvider.runInTransaction,
  concurrency,
});

await redis.quit();
await redisSubscription.quit();
await redisContainer.stop();
db.close();
