/**
 * Signals Showcase
 *
 * Demonstrates abort signal patterns for cooperative job processing.
 *
 * Scenarios:
 * 1. External Completion: Handler detects already_completed when completeChain is called externally
 * 2. Worker Stopping: Handler detects worker_stopping and wraps up gracefully
 */

import assert from "node:assert/strict";

import { createPgNotifyAdapter, createPgStateAdapter } from "@queuert/postgres";
import { acquirePostgres } from "@queuert/testcontainers";
import { createPostgresJsNotifyProvider } from "example-notify-postgres-postgres-js/provider";
import { createPostgresJsStateProvider } from "example-state-postgres-postgres-js/provider";
import postgres from "postgres";
import {
  createClient,
  createInProcessWorker,
  createProcessors,
  defineJobTypes,
  withTransactionHooks,
} from "queuert";

const jobTypes = defineJobTypes<{
  "poll-external-api": {
    entry: true;
    input: { taskId: string; maxPolls: number };
    output: { source: "handler" | "external"; result: string };
  };

  "process-batch": {
    entry: true;
    input: { batchId: string; itemCount: number };
    output: { processed: number; total: number; interrupted: boolean };
  };
}>();

const processItem = async () => new Promise<void>((resolve) => setTimeout(resolve, 50));

await using pg = await acquirePostgres("postgres:18", import.meta.url);
const sql = postgres(pg.connectionString, { max: 10 });

const stateProvider = createPostgresJsStateProvider({ sql });
const stateAdapter = await createPgStateAdapter({ stateProvider });
await stateAdapter.migrateToLatest();
const notifyProvider = createPostgresJsNotifyProvider({ sql });
const notifyAdapter = await createPgNotifyAdapter({ notifyProvider });

const client = await createClient({
  stateAdapter,
  notifyAdapter,
  jobTypes,
});

const processors = createProcessors({
  client,
  jobTypes,
  processors: {
    "poll-external-api": {
      leaseConfig: { leaseMs: 5000, renewIntervalMs: 1000 },
      attemptHandler: async ({ signal, job, complete }) => {
        console.log(`[poll-external-api] Polling for result (task ${job.input.taskId})`);
        onExternalResultStarted();

        for (let i = 0; i < job.input.maxPolls; i++) {
          if (signal.aborted) {
            console.log(`  Signal aborted: ${signal.reason} — stopping poll loop`);
            if (signal.reason === "already_completed") {
              throw new Error("Job completed externally");
            }
            break;
          }

          console.log(`  Poll ${i + 1}/${job.input.maxPolls}...`);
          await processItem();
        }

        return complete(async () => ({
          source: "handler",
          result: "completed-by-handler",
        }));
      },
    },

    "process-batch": {
      leaseConfig: { leaseMs: 5000, renewIntervalMs: 1000 },
      attemptHandler: async ({ signal, job, complete }) => {
        console.log(`[process-batch] Starting batch ${job.input.batchId}`);
        onBatchStarted();

        let processed = 0;
        for (let i = 0; i < job.input.itemCount; i++) {
          if (signal.aborted && signal.reason === "worker_stopping") {
            console.log(
              `  Worker stopping — wrapping up after ${processed}/${job.input.itemCount} items`,
            );
            break;
          }

          await processItem();
          processed++;
          if (processed % 5 === 0) {
            console.log(`  Processed ${processed}/${job.input.itemCount}`);
          }
        }

        return complete(async () => ({
          processed,
          total: job.input.itemCount,
          interrupted: processed < job.input.itemCount,
        }));
      },
    },
  },
});

let onExternalResultStarted: () => void;
const externalResultStarted = async () =>
  new Promise<void>((resolve) => {
    onExternalResultStarted = resolve;
  });

let onBatchStarted: () => void;
const batchStarted = async () =>
  new Promise<void>((resolve) => {
    onBatchStarted = resolve;
  });

// Scenario 1: External completion via completeChain
console.log("\n--- Scenario 1: External Completion (already_completed) ---");
console.log("Handler is waiting when completeChain is called externally.\n");

const externalTask = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (txSql) =>
    client.startChain({
      sql: txSql,
      transactionHooks,
      typeName: "poll-external-api",
      input: { taskId: "task-001", maxPolls: 100 },
    }),
  ),
);

const started1 = externalResultStarted();
const worker1 = await createInProcessWorker({ client, processors });
const stopWorker1 = await worker1.start();

await started1;
await new Promise((r) => setTimeout(r, 100));

console.log(`Completing chain externally...`);
await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (txSql) =>
    client.completeChain({
      sql: txSql,
      transactionHooks,
      ...externalTask,
      complete: async ({ job, complete }) => {
        await complete(job, async () => ({
          source: "external",
          result: "completed-via-api",
        }));
      },
    }),
  ),
);

const externalResult = await client.awaitChain(externalTask, { timeoutMs: 5000 });
console.log(`Result: ${JSON.stringify(externalResult.output)}`);
assert.equal(externalResult.output.source, "external");

await stopWorker1();

// Scenario 2: Worker stopping signal
console.log("\n--- Scenario 2: Worker Stopping Signal ---");
console.log("Worker stops while batch job is running. Handler wraps up gracefully.\n");

const batch = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (txSql) =>
    client.startChain({
      sql: txSql,
      transactionHooks,
      typeName: "process-batch",
      input: { batchId: "batch-001", itemCount: 100 },
    }),
  ),
);

const started2 = batchStarted();
const worker2 = await createInProcessWorker({ client, processors });
const stopWorker2 = await worker2.start();

await started2;
await new Promise((r) => setTimeout(r, 200));

console.log(`Stopping worker...`);
await stopWorker2();

const batchResult = await client.awaitChain(batch, { timeoutMs: 5000 });
console.log(`Result: ${JSON.stringify(batchResult.output)}`);
assert.equal(batchResult.output.interrupted, true);
assert.ok(batchResult.output.processed > 0 && batchResult.output.processed < 100);

await notifyAdapter.close();
await stateAdapter.close();
await sql.end();
