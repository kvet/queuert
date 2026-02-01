import { type ChildProcess, fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  type PgNotifyProvider,
  createPgNotifyAdapter,
  createPgStateAdapter,
} from "@queuert/postgres";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool, type PoolClient } from "pg";
import { createQueuertClient, defineJobTypes } from "queuert";

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

const registry = defineJobTypes<{
  process_order: {
    entry: true;
    input: { orderId: string; items: string[]; total: number };
    output: { processedAt: string; workerId: string };
  };
}>();

type DbContext = { poolClient: PoolClient };

console.log("Starting PostgreSQL container...");
const pgContainer = await new PostgreSqlContainer("postgres:14").withExposedPorts(5432).start();
const connectionString = pgContainer.getConnectionUri();

const pool = new Pool({ connectionString, max: 10 });

const stateAdapter = await createPgStateAdapter({
  stateProvider: {
    runInTransaction: async (cb) => {
      const poolClient = await pool.connect();
      try {
        await poolClient.query("BEGIN");
        const result = await cb({ poolClient });
        await poolClient.query("COMMIT");
        return result;
      } catch (error) {
        await poolClient.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        poolClient.release();
      }
    },
    executeSql: async ({ txContext, sql, params }) => {
      if (txContext) {
        const result = await (txContext as DbContext).poolClient.query(sql, params);
        return result.rows;
      }
      const poolClient = await pool.connect();
      try {
        const result = await poolClient.query(sql, params);
        return result.rows;
      } finally {
        poolClient.release();
      }
    },
  },
  schema: "public",
});
await stateAdapter.migrateToLatest();

let listenClient: PoolClient | null = null;
let connectingPromise: Promise<PoolClient> | null = null;
let closed = false;
const handlers = new Map<string, (message: string) => void>();

const releaseListenClient = (): void => {
  if (listenClient) {
    listenClient.removeAllListeners("notification");
    listenClient.release();
    listenClient = null;
  }
};

const notifyProvider: PgNotifyProvider = {
  publish: async (channel, message) => {
    const client = await pool.connect();
    try {
      await client.query("SELECT pg_notify($1, $2)", [channel, message]);
    } finally {
      client.release();
    }
  },
  subscribe: async (channel, onMessage) => {
    if (closed) throw new Error("Provider is closed");

    if (!listenClient && !connectingPromise) {
      connectingPromise = pool.connect().then((client) => {
        connectingPromise = null;
        if (closed) {
          client.release();
          throw new Error("Provider is closed");
        }
        listenClient = client;
        listenClient.on("notification", (msg: { channel: string; payload?: string }) => {
          handlers.get(msg.channel)?.(msg.payload ?? "");
        });
        return listenClient;
      });
    }

    const client = listenClient ?? (await connectingPromise!);
    handlers.set(channel, onMessage);
    await client.query(`LISTEN "${channel}"`);

    return async () => {
      handlers.delete(channel);
      try {
        await client.query(`UNLISTEN "${channel}"`);
      } finally {
        if (handlers.size === 0) releaseListenClient();
      }
    };
  },
};

const closeNotify = (): void => {
  closed = true;
  releaseListenClient();
  handlers.clear();
};

const notifyAdapter = await createPgNotifyAdapter({ provider: notifyProvider });

const qrtClient = await createQueuertClient({
  stateAdapter,
  notifyAdapter,
  registry,
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
    env: { ...process.env, CONNECTION_STRING: connectionString, WORKER_ID: workerId },
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
const jobChains = await qrtClient.withNotify(async () =>
  stateAdapter.runInTransaction(async (ctx) => {
    const chains = [];
    for (let i = 1; i <= JOBS_TO_PROCESS; i++) {
      const itemCount = 1 + Math.floor(Math.random() * 3);
      const items = Array.from(
        { length: itemCount },
        () => products[Math.floor(Math.random() * products.length)],
      );
      const total = Math.floor(Math.random() * 200) + 20;

      chains.push(
        await qrtClient.startJobChain({
          ...ctx,
          typeName: "process_order",
          input: { orderId: `ORD-${String(i).padStart(3, "0")}`, items, total },
        }),
      );
    }
    return chains;
  }),
);

await Promise.all(
  jobChains.map(async (chain) => qrtClient.waitForJobChainCompletion(chain, { timeoutMs: 30000 })),
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
closeNotify();
await pool.end();
await pgContainer.stop();
console.log("Done!");
