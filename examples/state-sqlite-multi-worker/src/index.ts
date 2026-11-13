import { type ChildProcess, fork } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createIpcNotifyAdapter } from "@queuert/ipc";
import { createSqliteStateAdapter } from "@queuert/sqlite";
import Database from "better-sqlite3";
import { createBetterSqlite3StateProvider } from "example-state-sqlite-better-sqlite3/provider";
import { createClient, defineJobTypes, withTxHooks } from "queuert";

const WORKER_COUNT = 3;
const JOBS_TO_PROCESS = 12;

const jobTypes = defineJobTypes<{
  process_order: {
    entry: true;
    input: { orderId: string };
    output: { processedAt: string; processName: string };
  };
}>();

const directory = mkdtempSync(join(tmpdir(), "queuert-sqlite-multi-worker-"));
const databasePath = join(directory, "queuert.db");
const ipcDirectory = join(directory, "ipc");

const db = new Database(databasePath);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

const stateAdapter = createSqliteStateAdapter({
  stateProvider: createBetterSqlite3StateProvider({ db }),
});
stateAdapter.migrateToLatest();

// #region ipc-notify
const notifyAdapter = createIpcNotifyAdapter({ directory: ipcDirectory });
// #endregion

const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

db.exec("CREATE TABLE orders (id TEXT PRIMARY KEY, items TEXT NOT NULL, total INTEGER NOT NULL)");

const processNames = ["alpha", "beta", "gamma"];
const processingLog: { orderId: string; processName: string }[] = [];
const processes: ChildProcess[] = [];

console.log(`Spawning ${WORKER_COUNT} worker processes...`);

const readyPromises = processNames.slice(0, WORKER_COUNT).map(async (processName) => {
  const child = fork(join(import.meta.dirname, "worker.ts"), [], {
    env: {
      ...process.env,
      DATABASE_PATH: databasePath,
      IPC_DIRECTORY: ipcDirectory,
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

const insertOrder = db.prepare("INSERT INTO orders (id, items, total) VALUES (?, ?, ?)");

const chains = withTxHooks((txHooks) =>
  db.transaction(() => {
    for (const order of orders) {
      insertOrder.run(order.id, JSON.stringify(order.items), order.total);
    }

    return client.createChains({
      db,
      txHooks,
      items: orders.map((order) => ({
        typeName: "process_order" as const,
        input: { orderId: order.id },
      })),
    });
  })(),
);

await Promise.all(chains.map(async (chain) => client.awaitChain(chain, { timeoutMs: 30_000 })));

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
// #region cleanup
notifyAdapter.close();
stateAdapter.close();
db.close();
// #endregion
rmSync(directory, { recursive: true, force: true });
console.log("Done!");
