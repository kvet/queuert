import { type ChildProcess, fork } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createPgNotifyAdapter, createPgStateAdapter } from "@queuert/postgres";
import { acquirePostgres } from "@queuert/testcontainers";
import { createPgPoolNotifyProvider } from "example-notify-postgres-pg/provider";
import { createPgPoolStateProvider } from "example-state-postgres-pg/provider";
import { Pool } from "pg";
import { createClient, defineJobTypes, withTransactionHooks } from "queuert";

// ============================================================================
// Multi-Worker Order Processing Example (with Child Processes)
// ============================================================================
//
// This example demonstrates multiple worker processes sharing the same PostgreSQL
// database, competing for jobs via database-level locking.
//
// Architecture:
//
//   ┌──────────────────────────────────────────────────────────────────┐
//   │                       PostgreSQL Database                        │
//   │  ┌─────────────────────────────────────────────────────────────┐ │
//   │  │                    Job Queue Table                          │ │
//   │  │  (workers use FOR UPDATE SKIP LOCKED for job acquisition)  │ │
//   │  └─────────────────────────────────────────────────────────────┘ │
//   │  ┌─────────────────────────────────────────────────────────────┐ │
//   │  │                 LISTEN/NOTIFY Channels                      │ │
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

const __dirname = dirname(fileURLToPath(import.meta.url));

const WORKER_COUNT = 3;
const JOBS_TO_PROCESS = 12;

const jobTypes = defineJobTypes<{
  process_order: {
    entry: true;
    input: { orderId: string; items: string[]; total: number };
    output: { processedAt: string; workerId: string };
  };
}>();

console.log("Starting PostgreSQL container...");
await using pg = await acquirePostgres("postgres:18", import.meta.url);

const pool = new Pool({ connectionString: pg.connectionString, max: 10 });

const stateProvider = createPgPoolStateProvider({ pool });
const stateAdapter = await createPgStateAdapter({ stateProvider });
await stateAdapter.migrateToLatest();

const notifyProvider = createPgPoolNotifyProvider({ pool });
const notifyAdapter = await createPgNotifyAdapter({ notifyProvider });

const client = await createClient({
  stateAdapter,
  notifyAdapter,
  jobTypes,
});

const workerNames = ["alpha", "beta", "gamma"];
const processingLog: { orderId: string; workerId: string }[] = [];
const processes: ChildProcess[] = [];

console.log(`\nSpawning ${WORKER_COUNT} worker processes...`);

const readyPromises: Promise<void>[] = [];
const workerPath = join(__dirname, "worker.ts");

for (let i = 0; i < WORKER_COUNT; i++) {
  const workerId = workerNames[i];
  const child = fork(workerPath, [], {
    execArgv: ["--import=tsx"],
    env: { ...process.env, CONNECTION_STRING: pg.connectionString, WORKER_ID: workerId },
    stdio: ["inherit", "inherit", "inherit", "ipc"],
  });

  processes.push(child);

  const readyPromise = new Promise<void>((resolve) => {
    child.on(
      "message",
      (msg: { type: string; orderId?: string; items?: number; total?: number }) => {
        if (msg.type === "ready") {
          console.log(`  Process "${workerId}" ready (concurrency: 2)`);
          resolve();
        } else if (msg.type === "processing") {
          console.log(
            `  [${workerId}] Processing order ${msg.orderId} (${msg.items} items, $${msg.total})`,
          );
          processingLog.push({ orderId: msg.orderId!, workerId });
        }
      },
    );
  });
  readyPromises.push(readyPromise);
}

await Promise.all(readyPromises);

console.log(`\nQueueing ${JOBS_TO_PROCESS} orders...\n`);

const products = ["Widget", "Gadget", "Gizmo", "Doohickey", "Thingamajig", "Contraption"];
const jobChains = await withTransactionHooks(async (transactionHooks) =>
  stateAdapter.withTransaction(async (ctx) =>
    client.startJobChains({
      ...ctx,
      transactionHooks,
      items: Array.from({ length: JOBS_TO_PROCESS }, (_, i) => {
        const itemCount = 1 + Math.floor(Math.random() * 3);
        const items = Array.from(
          { length: itemCount },
          () => products[Math.floor(Math.random() * products.length)],
        );
        const total = Math.floor(Math.random() * 200) + 20;
        return {
          typeName: "process_order" as const,
          input: { orderId: `ORD-${String(i + 1).padStart(3, "0")}`, items, total },
        };
      }),
    }),
  ),
);

await Promise.all(
  jobChains.map(async (chain) => client.awaitJobChain(chain, { timeoutMs: 30000 })),
);

console.log("\n" + "=".repeat(60));
console.log("Processing Summary");
console.log("=".repeat(60));

const workerStats = new Map<string, number>();
for (const entry of processingLog) {
  workerStats.set(entry.workerId, (workerStats.get(entry.workerId) ?? 0) + 1);
}

console.log("\nJobs processed per process:");
for (const [workerId, count] of workerStats.entries()) {
  const bar = "█".repeat(count);
  console.log(`  ${workerId.padEnd(6)} │ ${bar} ${count}`);
}

console.log("\nOrder processing details:");
for (const entry of processingLog) {
  console.log(`  ${entry.orderId} → processed by process "${entry.workerId}"`);
}

console.log("\n" + "=".repeat(60));
console.log(`Total orders: ${JOBS_TO_PROCESS}`);
console.log(`Processes used: ${workerStats.size}`);
console.log("=".repeat(60));

console.log("\nShutting down...");

const stopPromises = processes.map(
  async (child) =>
    new Promise<void>((resolve) => {
      child.on("message", (msg: { type: string }) => {
        if (msg.type === "stopped") resolve();
      });
      child.send("stop");
    }),
);

await Promise.all(stopPromises);
await notifyProvider.close();
await pool.end();
console.log("Done!");
