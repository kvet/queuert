/**
 * Cleanup Showcase
 *
 * Demonstrates the built-in cleanup job type and processor.
 *
 * Scenarios:
 * 1. Basic cleanup: Completed chains older than retention are deleted
 * 2. Idempotent scheduling: Multiple schedule calls create only one cleanup chain
 * 3. Self-rescheduling: The finished run schedules the next one
 */

import assert from "node:assert/strict";

import { createPgNotifyAdapter, createPgStateAdapter } from "@queuert/postgres";
import { acquirePostgres } from "@queuert/testcontainers";
import { createPostgresJsNotifyProvider } from "example-notify-postgres-postgres-js/provider";
import { createPostgresJsStateProvider } from "example-state-postgres-postgres-js/provider";
import postgres from "postgres";
import {
  createCleanupJobTypes,
  createCleanupProcessors,
  createClient,
  createInProcessWorker,
  createProcessors,
  defineJobTypes,
  withTransactionHooks,
} from "queuert";

// Set to e.g. 7 * 24 * 60 * 60 * 1000 for 7-day retention
const CLEANUP_RETENTION_MS = 0;
// Set to e.g. 60 * 60 * 1000 for 1-hour interval
const CLEANUP_INTERVAL_MS = 1000;
// Set to e.g. 1000
const CLEANUP_BATCH_SIZE = 3;

const userJobTypes = defineJobTypes<{
  "work.process": {
    entry: true;
    input: { taskId: number };
    output: { processedAt: string };
  };
}>();

await using pg = await acquirePostgres("postgres:18", import.meta.url);
const sql = postgres(pg.connectionString, { max: 10 });

const stateProvider = createPostgresJsStateProvider({ sql });
const stateAdapter = await createPgStateAdapter({ stateProvider });
await stateAdapter.migrateToLatest();
const notifyProvider = createPostgresJsNotifyProvider({ sql });
const notifyAdapter = await createPgNotifyAdapter({ notifyProvider });

// --- Mount the built-in cleanup slice alongside the application slice ---

const client = await createClient({
  stateAdapter,
  notifyAdapter,
  jobTypes: [createCleanupJobTypes(), userJobTypes],
});

const worker = await createInProcessWorker({
  client,
  processors: [
    createCleanupProcessors({ client, batchSize: CLEANUP_BATCH_SIZE }),
    createProcessors({
      client,
      jobTypes: userJobTypes,
      processors: {
        "work.process": {
          attemptHandler: async ({ job, complete }) => {
            console.log(`[work.process] Processing task #${job.input.taskId}`);
            return complete(async () => ({ processedAt: new Date().toISOString() }));
          },
        },
      },
    }),
  ],
});

const stopWorker = await worker.start();

// --- Scenario 1: Create and complete some work chains ---
console.log("\n--- Scenario 1: Create work chains ---\n");

const chains = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (txSql) => {
    const result = await client.createChains({
      sql: txSql,
      transactionHooks,
      items: [
        { typeName: "work.process", input: { taskId: 1 } },
        { typeName: "work.process", input: { taskId: 2 } },
        { typeName: "work.process", input: { taskId: 3 } },
        { typeName: "work.process", input: { taskId: 4 } },
        { typeName: "work.process", input: { taskId: 5 } },
        { typeName: "work.process", input: { taskId: 6 }, schedule: { afterMs: 60000 } },
      ],
    });
    return result;
  }),
);

console.log(`Created ${chains.length} work chains`);
assert.equal(chains.length, 6);

// Wait for immediate work chains to complete (chain #6 is scheduled in the future)
const immediateChains = chains.slice(0, 5);
await Promise.all(
  immediateChains.map(async (chain) => client.awaitChain(chain, { timeoutMs: 10000 })),
);
console.log(`${immediateChains.length} work chains completed, 1 scheduled for later`);

const beforeCleanup = await client.listChains({
  typeName: ["work.process"],
  limit: 100,
});
console.log(`\nChains before cleanup: ${beforeCleanup.items.length}`);
assert.equal(beforeCleanup.items.length, 6);

// --- Scenario 2: Schedule cleanup ---
console.log("\n--- Scenario 2: Schedule cleanup ---\n");

const scheduleCleanup = async () =>
  withTransactionHooks(async (transactionHooks) =>
    sql.begin(async (txSql) => {
      const result = await client.createChain({
        sql: txSql,
        transactionHooks,
        typeName: "__queuert/cleanup",
        input: { retentionMs: CLEANUP_RETENTION_MS, intervalMs: CLEANUP_INTERVAL_MS },
        deduplication: { key: "__queuert/cleanup", scope: "running" },
      });
      return result;
    }),
  );

const cleanupChain = await scheduleCleanup();
console.log(`Cleanup chain created: ${cleanupChain.id}`);
console.log(`Deduplicated: ${cleanupChain.deduplicated}`);
assert.equal(cleanupChain.deduplicated, false);

const duplicate = await scheduleCleanup();
console.log(`\nSecond schedule attempt: ${duplicate.id}`);
console.log(`Deduplicated: ${duplicate.deduplicated} (same chain returned)`);
assert.equal(duplicate.deduplicated, true);
assert.equal(duplicate.id, cleanupChain.id);

await client.awaitChain(cleanupChain, { timeoutMs: 10000 });
console.log("\nCleanup completed!");

const afterCleanup = await client.listChains({
  typeName: ["work.process"],
  limit: 100,
});
console.log(`Chains after cleanup: ${afterCleanup.items.length}`);
assert.equal(afterCleanup.items.length, 1, "only the future-scheduled chain should remain");

// --- Scenario 3: The finished run scheduled the next one ---
console.log("\n--- Scenario 3: Next run ---\n");

const pendingCleanup = await client.listJobs({
  typeName: ["__queuert/cleanup"],
  status: "pending",
  limit: 10,
});
assert.equal(pendingCleanup.items.length, 1, "next cleanup run should be scheduled");
console.log(`Next cleanup run scheduled at: ${pendingCleanup.items[0].scheduledAt.toISOString()}`);

// Deleting rows does not return disk to the OS — vacuum is on the state adapter
await stateAdapter.vacuum();
console.log("Vacuumed");

console.log("\n" + "-".repeat(40));
console.log("SHOWCASE COMPLETED");
console.log("-".repeat(40));

await stopWorker();
await notifyAdapter.close();
await stateAdapter.close();
await sql.end();
