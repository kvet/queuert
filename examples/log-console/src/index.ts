import { createSqliteStateAdapter } from "@queuert/sqlite";
import Database from "better-sqlite3";
import { createBetterSqlite3StateProvider } from "example-state-sqlite-better-sqlite3/provider";
import {
  createClient,
  createConsoleLog,
  createWorkerRunner,
  createProcessors,
  defineJobTypes,
} from "queuert";

// Define job types
const jobTypes = defineJobTypes<{
  greet: {
    entry: true;
    input: { name: string };
    output: { greeting: string };
  };
  "might-fail": {
    entry: true;
    input: { shouldFail: boolean };
    output: { success: true };
  };
}>();

// Create adapters with console logging
using drivers = new DisposableStack();
const db = drivers.adopt(new Database(":memory:"), (db) => {
  db.close();
});
using stateAdapter = createSqliteStateAdapter({
  stateProvider: createBetterSqlite3StateProvider({ db }),
});
stateAdapter.migrateToLatest();
// #region client
const log = createConsoleLog();

const client = createClient({
  stateAdapter,
  log,
  jobTypes,
});
// #endregion

// Create and start worker runner
await using workerRunner = createWorkerRunner({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      greet: {
        attemptHandler: async ({ job, complete }) => {
          console.log(`[app] Processing greeting for ${job.input.name}`);

          return stateAdapter.withTransaction((ctx) =>
            complete({
              ...ctx,
              output: { greeting: `Hello, ${job.input.name}!` },
            }),
          );
        },
      },
      "might-fail": {
        attemptHandler: async ({ job, complete }) => {
          console.log("[app] Processing might-fail job");

          if (job.input.shouldFail && job.attempt < 2) {
            throw new Error("Simulated failure for demonstration");
          }

          return stateAdapter.withTransaction((ctx) =>
            complete({ ...ctx, output: { success: true as const } }),
          );
        },
        backoffConfig: { initialDelayMs: 100, maxDelayMs: 100 },
      },
    },
  }),
});

await workerRunner.start();

// Run successful job
console.log("\n--- Running successful job ---\n");
const successChain = stateAdapter.withTransaction((ctx) =>
  client.createChain({
    ...ctx,
    typeName: "greet",
    input: { name: "World" },
  }),
);
await client.awaitChain(successChain, { timeoutMs: 5000 });

// Run job that fails then succeeds (demonstrates error logging)
console.log("\n--- Running job that fails first attempt ---\n");
const failThenSucceedChain = stateAdapter.withTransaction((ctx) =>
  client.createChain({
    ...ctx,
    typeName: "might-fail",
    input: { shouldFail: true },
  }),
);
await client.awaitChain(failThenSucceedChain, { timeoutMs: 5000 });
