import { createAsyncRwLock, createSqliteStateAdapter } from "@queuert/sqlite";
import Database from "better-sqlite3";
import { createBetterSqlite3StateProvider } from "example-state-sqlite-better-sqlite3/provider";
import {
  createClient,
  createProcessors,
  createWorkerRunner,
  defineJobTypes,
  withTxHooks,
} from "queuert";

import { createMemoryNotifyAdapter } from "./notify-adapter.ts";

const jobTypes = defineJobTypes<{
  generate_report: {
    entry: true;
    input: { reportType: string };
    output: { reportId: string; rowCount: number };
  };
}>();

// Create the state adapter
const db = new Database(":memory:");
const stateAdapter = createSqliteStateAdapter({
  stateProvider: createBetterSqlite3StateProvider({ db, lock: createAsyncRwLock() }),
});
await stateAdapter.migrateToLatest();

// #region setup
const notifyAdapter = createMemoryNotifyAdapter();

const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
// #endregion

const workerRunner = createWorkerRunner({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      generate_report: {
        attemptHandler: async ({ job, complete }) => {
          console.log(`Generating ${job.input.reportType} report...`);
          return withTxHooks(async (txHooks) =>
            stateAdapter.withTransaction(async (ctx) =>
              complete({
                ...ctx,
                txHooks,
                output: { reportId: `RPT-${Date.now()}`, rowCount: 42 },
              }),
            ),
          );
        },
      },
    },
  }),
});

const stopWorkerRunner = await workerRunner.start();

console.log("Requesting sales report...");
const chain = await withTxHooks(async (txHooks) =>
  stateAdapter.withTransaction(async (ctx) =>
    client.createChain({
      ...ctx,
      txHooks,
      typeName: "generate_report",
      input: { reportType: "sales" },
    }),
  ),
);

const result = await client.awaitChain(chain, { timeoutMs: 5000 });
console.log(`Report ready! ID: ${result.output.reportId}, Rows: ${result.output.rowCount}`);

// Cleanup
await stopWorkerRunner();
await notifyAdapter.close();
await stateAdapter.close();
db.close();
console.log("Done!");
