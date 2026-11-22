import { type ChildProcess, fork } from "node:child_process";
import { join } from "node:path";

import { createMysqlStateAdapter } from "@queuert/mysql";
import { acquireMysql } from "@queuert/testcontainers";
import { createMysql2PoolStateProvider } from "example-mysql-state-mysql2/provider";
import { createPool } from "mysql2/promise";
import { createClient, defineJobTypes } from "queuert";

// ============================================================================
// Multi-Worker Order Processing Example (with Child Processes)
// ============================================================================
//
// This example demonstrates multiple worker processes sharing the same MySQL
// database, competing for jobs via database-level locking. MySQL has no
// notify adapter, so every process polls for new jobs and finished chains.
//
// Architecture:
//
//   ┌──────────────────────────────────────────────────────────────────┐
//   │                          MySQL Database                          │
//   │  ┌─────────────────────────────────────────────────────────────┐ │
//   │  │                    Job Queue Table                          │ │
//   │  │  (workers use FOR UPDATE SKIP LOCKED for job acquisition)  │ │
//   │  └─────────────────────────────────────────────────────────────┘ │
//   └──────────────────────────────────────────────────────────────────┘
//                ▲                  ▲                  ▲
//                │ poll             │ poll             │ poll
//         ┌──────────┐       ┌──────────┐       ┌──────────┐
//         │ Process 1│       │ Process 2│       │ Process 3│
//         │ (alpha)  │       │  (beta)  │       │ (gamma)  │
//         └──────────┘       └──────────┘       └──────────┘
//
// ============================================================================

const WORKER_COUNT = 3;
const JOBS_TO_PROCESS = 12;
const POLL_INTERVAL_MS = 500;

const jobTypes = defineJobTypes<{
  process_order: {
    entry: true;
    input: { orderId: string };
    output: { processedAt: string; processName: string };
  };
}>();

console.log("Starting MySQL container...");
await using mysql = await acquireMysql("mysql:26", import.meta.url);

await using drivers = new AsyncDisposableStack();
const db = drivers.adopt(
  createPool({ ...mysql.connectionOptions, connectionLimit: 10 }),
  async (pool) => pool.end(),
);

await db.query(`
  CREATE TABLE IF NOT EXISTS orders (
    id VARCHAR(32) PRIMARY KEY,
    items JSON NOT NULL,
    total INT NOT NULL
  )
`);

const stateProvider = createMysql2PoolStateProvider({ pool: db });
await using stateAdapter = createMysqlStateAdapter({ stateProvider, dialect: "mysql" });
await stateAdapter.migrateToLatest();

const client = createClient({ stateAdapter, jobTypes });

const processNames = ["alpha", "beta", "gamma"];
const processingLog: { orderId: string; processName: string }[] = [];
const processes: ChildProcess[] = [];

console.log(`\nSpawning ${WORKER_COUNT} worker processes...`);

const readyPromises = processNames.slice(0, WORKER_COUNT).map(async (processName) => {
  const child = fork(join(import.meta.dirname, "worker.ts"), [], {
    env: {
      ...process.env,
      MYSQL_CONNECTION_OPTIONS: JSON.stringify(mysql.connectionOptions),
      POLL_INTERVAL_MS: String(POLL_INTERVAL_MS),
      PROCESS_NAME: processName,
    },
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
  id: `ORD-${String(i + 1).padStart(3, "0")}`,
  items: Array.from(
    { length: 1 + Math.floor(Math.random() * 3) },
    () => products[Math.floor(Math.random() * products.length)],
  ),
  total: Math.floor(Math.random() * 200) + 20,
}));

// Orders and their jobs are created in one transaction — workers only ever see
// orders that were committed
const chains = await stateProvider.withTransaction(async (txCtx) => {
  for (const order of orders) {
    await txCtx.connection.query("INSERT INTO orders (id, items, total) VALUES (?, ?, ?)", [
      order.id,
      JSON.stringify(order.items),
      order.total,
    ]);
  }

  return client.createChains({
    ...txCtx,
    items: orders.map((order) => ({
      typeName: "process_order" as const,
      input: { orderId: order.id },
    })),
  });
});

await client.awaitChains({ chains, timeoutMs: 30_000, pollIntervalMs: POLL_INTERVAL_MS });

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
