/**
 * Cleanup Showcase
 *
 * Demonstrates how to implement automatic cleanup of completed job chains
 * as a custom job type using standard Queuert primitives.
 *
 * Scenarios:
 * 1. Basic cleanup: Completed chains older than retention are deleted
 * 2. Idempotent scheduling: Multiple schedule calls create only one cleanup chain
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

// Set to e.g. 7 * 24 * 60 * 60 * 1000 for 7-day retention
const CLEANUP_RETENTION_MS = 0;
// Set to e.g. 1000
const CLEANUP_BATCH_SIZE = 3;
// Set to e.g. 60 * 60 * 1000 for 1-hour interval
const CLEANUP_INTERVAL_MS = 1000;

// --- Define a custom cleanup job type alongside user job types ---

const cleanupJobTypes = defineJobTypes<{
  "queuert.cleanup": {
    entry: true;
    input: null;
    output: null;
  };
}>();

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

const client = await createClient({
  stateAdapter,
  notifyAdapter,
  jobTypes: [cleanupJobTypes, userJobTypes],
});

// --- Define the cleanup processor ---

const cleanupProcessorRegistry = createProcessors({
  client,
  jobTypes: cleanupJobTypes,
  processors: {
    "queuert.cleanup": {
      attemptHandler: async ({ job, complete }) => {
        const cutoffDate = new Date(Date.now() - CLEANUP_RETENTION_MS);
        let deletedChainCount = 0;
        let cursor: string | undefined;

        do {
          const page = await client.listJobChains({
            filter: { root: true, to: cutoffDate },
            orderDirection: "asc",
            limit: CLEANUP_BATCH_SIZE,
            ...(cursor != null ? { cursor } : {}),
          });

          const jobChainsToDelete = page.items.filter(
            (jobChain) => jobChain.id !== job.chainId && jobChain.status === "completed",
          );

          if (jobChainsToDelete.length > 0) {
            const deleted = await withTransactionHooks(async (transactionHooks) =>
              sql.begin(async (txSql) => {
                const result = await client.deleteJobChains({
                  sql: txSql,
                  transactionHooks,
                  ids: jobChainsToDelete.map((jobChain) => jobChain.id),
                });
                return result;
              }),
            );
            deletedChainCount += deleted.length;
          }

          cursor = page.nextCursor ?? undefined;
        } while (cursor);

        console.log(`[queuert.cleanup] Deleted ${deletedChainCount} chain(s)`);

        await stateAdapter.vacuum();

        return complete(async ({ sql, transactionHooks }) => {
          await client.startJobChain({
            sql,
            transactionHooks,
            typeName: "queuert.cleanup",
            input: null,
            schedule: { afterMs: CLEANUP_INTERVAL_MS },
            deduplication: {
              key: "queuert.cleanup",
              scope: "incomplete",
              excludeJobChainIds: [job.chainId],
            },
          });

          return null;
        });
      },
    },
  },
});

const worker = await createInProcessWorker({
  client,
  processors: [
    cleanupProcessorRegistry,
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

const jobChains = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (txSql) => {
    const result = await client.startJobChains({
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

console.log(`Created ${jobChains.length} work chains`);
assert.equal(jobChains.length, 6);

// Wait for immediate work chains to complete (chain #6 is scheduled in the future)
const immediateJobChains = jobChains.slice(0, 5);
await Promise.all(
  immediateJobChains.map(async (jobChain) => client.awaitJobChain(jobChain, { timeoutMs: 10000 })),
);
console.log(`${immediateJobChains.length} work chains completed, 1 scheduled for later`);

// Check chain count before cleanup
const beforeCleanup = await client.listJobChains({
  filter: { typeName: ["work.process"] },
  limit: 100,
});
console.log(`\nChains before cleanup: ${beforeCleanup.items.length}`);
assert.equal(beforeCleanup.items.length, 6);

// --- Scenario 2: Run cleanup ---
console.log("\n--- Scenario 2: Schedule cleanup ---\n");

const scheduleCleanup = async () =>
  withTransactionHooks(async (transactionHooks) =>
    sql.begin(async (txSql) => {
      const result = await client.startJobChain({
        sql: txSql,
        transactionHooks,
        typeName: "queuert.cleanup",
        input: null,
        deduplication: { key: "queuert.cleanup", scope: "incomplete" },
      });
      return result;
    }),
  );

const cleanupJobChain = await scheduleCleanup();
console.log(`Cleanup chain started: ${cleanupJobChain.id}`);
console.log(`Deduplicated: ${cleanupJobChain.deduplicated}`);
assert.equal(cleanupJobChain.deduplicated, false);

// --- Idempotent scheduling ---
const duplicate = await scheduleCleanup();
console.log(`\nSecond schedule attempt: ${duplicate.id}`);
console.log(`Deduplicated: ${duplicate.deduplicated} (same chain returned)`);
assert.equal(duplicate.deduplicated, true);
assert.equal(duplicate.id, cleanupJobChain.id);

// Wait for cleanup to finish
await client.awaitJobChain({ id: cleanupJobChain.id }, { timeoutMs: 10000 });
console.log("\nCleanup completed!");

// Check chain count after cleanup
const afterCleanup = await client.listJobChains({
  filter: { typeName: ["work.process"] },
  limit: 100,
});
console.log(`Chains after cleanup: ${afterCleanup.items.length}`);
assert.equal(afterCleanup.items.length, 1, "only the future-scheduled chain should remain");

// Check that a next cleanup run was scheduled
const pendingCleanup = await client.listJobs({
  filter: { typeName: ["queuert.cleanup"], status: ["pending"] },
  limit: 10,
});
console.log(`\nNext cleanup run scheduled: ${pendingCleanup.items.length > 0 ? "yes" : "no"}`);
assert.equal(pendingCleanup.items.length, 1, "next cleanup run should be scheduled");
console.log(`Scheduled at: ${pendingCleanup.items[0].scheduledAt.toISOString()}`);

console.log("\n" + "-".repeat(40));
console.log("SHOWCASE COMPLETED");
console.log("-".repeat(40));

await stopWorker();
await sql.end();
