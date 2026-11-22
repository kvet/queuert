import { type ChildProcess, fork } from "node:child_process";
import { join } from "node:path";

import { createRedisNotifyAdapter, createRedisStateAdapter } from "@queuert/redis";
import { acquireRedis } from "@queuert/testcontainers";
import { createNodeRedisNotifyProvider } from "example-postgresql-notify-redis-redis/provider";
import { createNodeRedisStateProvider } from "example-redis-state-redis/provider";
import { createClient, defineJobTypes } from "queuert";
import { createClient as createRedisClient } from "redis";

// ============================================================================
// Multi-Worker Order Processing Example (with Child Processes)
// ============================================================================
//
// This example demonstrates multiple worker processes sharing one Redis
// instance for both job state and notifications.
//
// Architecture:
//
//   ┌──────────────────────────────────────────────────────────────────┐
//   │                              Redis                               │
//   │  ┌─────────────────────────────────────────────────────────────┐ │
//   │  │                     {queuert}:* keys                        │ │
//   │  │   (optimistic transactions; one worker claims each job)     │ │
//   │  └─────────────────────────────────────────────────────────────┘ │
//   │  ┌─────────────────────────────────────────────────────────────┐ │
//   │  │                    Pub/Sub Channels                         │ │
//   │  │     (real-time notifications when new jobs are queued)      │ │
//   │  └─────────────────────────────────────────────────────────────┘ │
//   └──────────────────────────────────────────────────────────────────┘
//                │                  │                  │
//                ▼                  ▼                  ▼
//         ┌──────────┐       ┌──────────┐       ┌──────────┐
//         │ Process 1│       │ Process 2│       │ Process 3│
//         │ (alpha)  │       │  (beta)  │       │ (gamma)  │
//         └──────────┘       └──────────┘       └──────────┘
//
// ============================================================================

const WORKER_COUNT = 3;
const JOBS_TO_PROCESS = 12;

const jobTypes = defineJobTypes<{
  process_order: {
    entry: true;
    input: { orderId: string; items: string[]; total: number };
    output: { processedAt: string; processName: string };
  };
}>();

console.log("Starting Redis container...");
await using redisContainer = await acquireRedis("redis:8");

await using drivers = new AsyncDisposableStack();
const redis = drivers.adopt(
  await createRedisClient({ url: redisContainer.connectionUrl }).connect(),
  async (redis) => {
    await redis.close();
  },
);
const redisSubscription = drivers.adopt(
  await createRedisClient({ url: redisContainer.connectionUrl }).connect(),
  async (redisSubscription) => {
    await redisSubscription.close();
  },
);

await using stateAdapter = createRedisStateAdapter({
  stateProvider: createNodeRedisStateProvider({ client: redis }),
  keyPrefix: "{queuert}:",
});
await stateAdapter.migrateToLatest();

await using notifyAdapter = createRedisNotifyAdapter({
  notifyProvider: createNodeRedisNotifyProvider({
    client: redis,
    subscribeClient: redisSubscription,
  }),
});

const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

const processNames = ["alpha", "beta", "gamma"];
const processingLog: { orderId: string; processName: string }[] = [];
const processes: ChildProcess[] = [];

console.log(`\nSpawning ${WORKER_COUNT} worker processes...`);

const readyPromises = processNames.slice(0, WORKER_COUNT).map(async (processName) => {
  const child = fork(join(import.meta.dirname, "worker.ts"), [], {
    env: { ...process.env, REDIS_URL: redisContainer.connectionUrl, PROCESS_NAME: processName },
    stdio: ["inherit", "inherit", "inherit", "ipc"],
  });
  processes.push(child);

  return new Promise<void>((resolve) => {
    child.on(
      "message",
      (msg: { type: string; orderId?: string; items?: number; total?: number }) => {
        if (msg.type === "ready") {
          console.log(`  Process "${processName}" ready (concurrency: 2)`);
          resolve();
        } else if (msg.type === "processing") {
          console.log(
            `  [${processName}] Processing order ${msg.orderId} (${msg.items} items, $${msg.total})`,
          );
          processingLog.push({ orderId: msg.orderId!, processName });
        }
      },
    );
  });
});

await Promise.all(readyPromises);

console.log(`\nQueueing ${JOBS_TO_PROCESS} orders...\n`);

const products = ["Widget", "Gadget", "Gizmo", "Doohickey", "Thingamajig", "Contraption"];
const orders = Array.from({ length: JOBS_TO_PROCESS }, (_, i) => ({
  orderId: `ORD-${String(i + 1).padStart(3, "0")}`,
  items: Array.from(
    { length: 1 + Math.floor(Math.random() * 3) },
    () => products[Math.floor(Math.random() * products.length)],
  ),
  total: Math.floor(Math.random() * 200) + 20,
}));

const chains = await stateAdapter.withTransaction(async (txCtx) =>
  client.createChains({
    ...txCtx,
    items: orders.map((order) => ({ typeName: "process_order" as const, input: order })),
  }),
);

await client.awaitChains({ chains, timeoutMs: 30_000 });

console.log("\n" + "=".repeat(60));
console.log("Processing Summary");
console.log("=".repeat(60));

const processStats = new Map<string, number>();
for (const entry of processingLog) {
  processStats.set(entry.processName, (processStats.get(entry.processName) ?? 0) + 1);
}

console.log("\nJobs processed per process:");
for (const [processName, count] of processStats.entries()) {
  console.log(`  ${processName.padEnd(6)} │ ${"█".repeat(count)} ${count}`);
}

console.log("\n" + "=".repeat(60));
console.log(`Total orders: ${JOBS_TO_PROCESS}`);
console.log(`Processes used: ${processStats.size}`);
console.log("=".repeat(60));

console.log("\nShutting down...");

await Promise.all(
  processes.map(
    async (child) =>
      new Promise<void>((resolve) => {
        child.on("message", (msg: { type: string }) => {
          if (msg.type === "stopped") resolve();
        });
        child.send("stop");
      }),
  ),
);
console.log("Done!");
