import { type ChildProcess, fork } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createPgNotifyAdapter, createPgStateAdapter } from "@queuert/postgres";
import { acquirePostgres } from "@queuert/testcontainers";
import { createPostgresJsNotifyProvider } from "example-notify-postgres-postgres-js/provider";
import { createPostgresJsStateProvider } from "example-state-postgres-postgres-js/provider";
import postgres from "postgres";
import { createClient, defineJobTypes, withTxHooks } from "queuert";

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
    input: { orderId: string };
    output: { processedAt: string; processName: string };
  };
}>();

console.log("Starting PostgreSQL container...");
await using pg = await acquirePostgres("postgres:18", import.meta.url);

await using drivers = new AsyncDisposableStack();
const sql = drivers.adopt(postgres(pg.connectionString, { max: 10 }), async (sql) => sql.end());

await sql`
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    items TEXT[] NOT NULL,
    total INTEGER NOT NULL
  )
`;

const stateProvider = createPostgresJsStateProvider({ sql });
await using stateAdapter = createPgStateAdapter({ stateProvider });
await stateAdapter.migrateToLatest();

const notifyProvider = createPostgresJsNotifyProvider({ sql });
await using notifyAdapter = createPgNotifyAdapter({ notifyProvider });

const client = createClient({
  stateAdapter,
  notifyAdapter,
  jobTypes,
});

const processNames = ["alpha", "beta", "gamma"];
const processingLog: { orderId: string; processName: string }[] = [];
const processes: ChildProcess[] = [];

console.log(`\nSpawning ${WORKER_COUNT} worker processes...`);

const readyPromises: Promise<void>[] = [];
const workerPath = join(__dirname, "worker.ts");

for (let i = 0; i < WORKER_COUNT; i++) {
  const processName = processNames[i];
  const child = fork(workerPath, [], {
    env: { ...process.env, CONNECTION_STRING: pg.connectionString, PROCESS_NAME: processName },
    stdio: ["inherit", "inherit", "inherit", "ipc"],
  });

  processes.push(child);

  const readyPromise = new Promise<void>((resolve) => {
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
  readyPromises.push(readyPromise);
}

await Promise.all(readyPromises);

console.log(`\nQueueing ${JOBS_TO_PROCESS} orders...\n`);

const products = ["Widget", "Gadget", "Gizmo", "Doohickey", "Thingamajig", "Contraption"];
const orders = Array.from({ length: JOBS_TO_PROCESS }, (_, i) => {
  const itemCount = 1 + Math.floor(Math.random() * 3);
  return {
    id: `ORD-${String(i + 1).padStart(3, "0")}`,
    items: Array.from(
      { length: itemCount },
      () => products[Math.floor(Math.random() * products.length)],
    ),
    total: Math.floor(Math.random() * 200) + 20,
  };
});

// Orders and their jobs are created in one transaction — workers only ever see
// orders that were committed
const chains = await withTxHooks(async (txHooks) =>
  sql.begin(async (txSql) => {
    for (const order of orders) {
      await txSql`INSERT INTO orders (id, items, total) VALUES (${order.id}, ${order.items}, ${order.total})`;
    }

    return client.createChains({
      txSql,
      txHooks,
      items: orders.map((order) => ({
        typeName: "process_order" as const,
        input: { orderId: order.id },
      })),
    });
  }),
);

await Promise.all(chains.map(async (chain) => client.awaitChain(chain, { timeoutMs: 30000 })));

console.log("\n" + "=".repeat(60));
console.log("Processing Summary");
console.log("=".repeat(60));

const processStats = new Map<string, number>();
for (const entry of processingLog) {
  processStats.set(entry.processName, (processStats.get(entry.processName) ?? 0) + 1);
}

console.log("\nJobs processed per process:");
for (const [processName, count] of processStats.entries()) {
  const bar = "█".repeat(count);
  console.log(`  ${processName.padEnd(6)} │ ${bar} ${count}`);
}

console.log("\nOrder processing details:");
for (const entry of processingLog) {
  console.log(`  ${entry.orderId} → processed by process "${entry.processName}"`);
}

console.log("\n" + "=".repeat(60));
console.log(`Total orders: ${JOBS_TO_PROCESS}`);
console.log(`Processes used: ${processStats.size}`);
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
console.log("Done!");
