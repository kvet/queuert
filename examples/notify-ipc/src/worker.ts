import { createIpcNotifyAdapter } from "@queuert/ipc";
import { createSqliteStateAdapter } from "@queuert/sqlite";
import Database from "better-sqlite3";
import { createBetterSqlite3StateProvider } from "example-state-sqlite-better-sqlite3/provider";
import { createProcessors, createClient, createWorkerRunner } from "queuert";

import { jobTypes } from "./job-types.ts";

// Open the database file the main process created
const db = new Database(process.env.DATABASE_PATH);
db.pragma("busy_timeout = 5000");
const stateAdapter = createSqliteStateAdapter({
  stateProvider: createBetterSqlite3StateProvider({ db }),
});

// Join the same IPC directory as the main process
const notifyAdapter = createIpcNotifyAdapter({ directory: process.env.IPC_DIRECTORY! });

const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

const workerRunner = createWorkerRunner({
  client,
  // A notification sent before this process listens is lost; the next poll picks the job up
  pollIntervalMs: 1_000,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      generate_report: {
        attemptHandler: async ({ job, complete }) => {
          console.log(`[worker] Generating ${job.input.reportType} report...`);
          // Simulate report generation work
          await new Promise((r) => setTimeout(r, 500));
          const rowCount = Math.floor(Math.random() * 1000) + 100;
          console.log(`[worker] Report generated with ${rowCount} rows`);
          return stateAdapter.withTransaction((ctx) =>
            complete({ ...ctx, output: { reportId: `RPT-${Date.now()}`, rowCount } }),
          );
        },
      },
    },
  }),
});

await workerRunner.start();
process.send!("ready");

process.on("message", (message) => {
  if (message !== "stop") return;
  void (async () => {
    await workerRunner.close();
    notifyAdapter.close();
    stateAdapter.close();
    db.close();
    process.exit(0);
  })();
});
