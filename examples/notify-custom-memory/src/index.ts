import { createSqliteStateAdapter } from "@queuert/sqlite";
import BetterSqlite3 from "better-sqlite3";
import { createKyselySqliteStateProvider } from "example-state-sqlite-kysely/provider";
import { Kysely, SqliteDialect } from "kysely";
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
await using db = new Kysely<Record<string, never>>({
  dialect: new SqliteDialect({ database: new BetterSqlite3(":memory:") }),
});
await using stateAdapter = createSqliteStateAdapter({
  stateProvider: createKyselySqliteStateProvider({ db }),
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

// The worker runner polls only once a minute, so it picks up the job as soon as it is
// woken by the notify adapter
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
