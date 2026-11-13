import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createIpcNotifyAdapter } from "@queuert/ipc";
import { createSqliteStateAdapter } from "@queuert/sqlite";
import Database from "better-sqlite3";
import { createBetterSqlite3StateProvider } from "example-state-sqlite-better-sqlite3/provider";
import { createClient } from "queuert";

import { jobTypes } from "./job-types.ts";

// Both processes share one SQLite file and one IPC directory
using drivers = new DisposableStack();
const directory = drivers.adopt(mkdtempSync(join(tmpdir(), "queuert-notify-ipc-")), (path) => {
  rmSync(path, { recursive: true, force: true });
});
const databasePath = join(directory, "queuert.db");
const ipcDirectory = join(directory, "ipc");

// Create the state adapter
const db = drivers.adopt(new Database(databasePath), (database) => {
  database.close();
});
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");
using stateAdapter = createSqliteStateAdapter({
  stateProvider: createBetterSqlite3StateProvider({ db }),
});
stateAdapter.migrateToLatest();

// #region setup
// Create the notify adapter: every process passing the same directory reaches the others
using notifyAdapter = createIpcNotifyAdapter({
  directory: ipcDirectory,
  onError: (error) => {
    console.error("IPC notify adapter error", error);
  },
});
// #endregion

const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

// Start the worker in a separate process
console.log("Starting worker process...");
const worker = fork(join(import.meta.dirname, "worker.ts"), [], {
  env: { ...process.env, DATABASE_PATH: databasePath, IPC_DIRECTORY: ipcDirectory },
});
await once(worker, "message");

console.log("Requesting sales report...");
const chain = stateAdapter.withTransaction((ctx) =>
  client.createChain({
    ...ctx,
    typeName: "generate_report",
    input: { reportType: "sales", dateRange: { from: "2024-01-01", to: "2024-12-31" } },
  }),
);

// Main process continues with other work while the worker process runs the job
console.log("Report queued! Continuing with other work...");
console.log("Preparing email template...");
await new Promise((resolve) => setTimeout(resolve, 100));
console.log("Loading recipient list...");
await new Promise((resolve) => setTimeout(resolve, 100));

// Now wait for the report to be ready
console.log("Waiting for report...");
const result = await client.awaitChain(chain, { timeoutMs: 5000 });
console.log(`Report ready! ID: ${result.output.reportId}, Rows: ${result.output.rowCount}`);

// Stop the worker process; the adapters and the database close when the scope ends
worker.send("stop");
await once(worker, "exit");
console.log("Done!");
