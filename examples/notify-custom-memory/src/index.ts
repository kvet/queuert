import { createAsyncRwLock, createSqliteStateAdapter } from "@queuert/sqlite";
import Database from "better-sqlite3";
import { createBetterSqlite3StateProvider } from "example-state-sqlite-better-sqlite3/provider";
import { createClient, createProcessors, createWorkerRunner, defineJobTypes } from "queuert";

import { createMemoryNotifyAdapter } from "./notify-adapter.ts";

const jobTypes = defineJobTypes<{
  generate_report: {
    entry: true;
    input: { reportType: string };
    output: { reportId: string; rowCount: number };
  };
}>();

// Create the state adapter
await using drivers = new AsyncDisposableStack();
const db = drivers.adopt(new Database(":memory:"), (db) => {
  db.close();
});
await using stateAdapter = createSqliteStateAdapter({
  stateProvider: createBetterSqlite3StateProvider({ db, lock: createAsyncRwLock() }),
});
await stateAdapter.migrateToLatest();

// #region setup
await using notifyAdapter = createMemoryNotifyAdapter();

const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
// #endregion

await using workerRunner = createWorkerRunner({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      generate_report: {
        attemptHandler: async ({ job, complete }) => {
          console.log(`Generating ${job.input.reportType} report...`);
          return stateAdapter.withTransaction(async (ctx) =>
            complete({
              ...ctx,
              output: { reportId: `RPT-${Date.now()}`, rowCount: 42 },
            }),
          );
        },
      },
    },
  }),
});

await workerRunner.start();

console.log("Requesting sales report...");
const chain = await stateAdapter.withTransaction(async (ctx) =>
  client.createChain({
    ...ctx,
    typeName: "generate_report",
    input: { reportType: "sales" },
  }),
);

const result = await client.awaitChain(chain, { timeoutMs: 5000 });
console.log(`Report ready! ID: ${result.output.reportId}, Rows: ${result.output.rowCount}`);

console.log("Done!");
