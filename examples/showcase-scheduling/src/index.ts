/**
 * Scheduling Showcase
 *
 * Demonstrates recurring job patterns without external cron.
 *
 * Scenarios:
 * 1. Recurring Jobs: Independent chains with scheduled delays
 * 2. Deduplication: Prevent duplicate recurring job instances
 * 3. Time-Windowed: Rate-limit job creation with windowMs
 * 4. Trigger Early: Run a future-scheduled job immediately
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
  /*
   * Workflow (daily-digest, health-check):
   *   chain₁ --> output  (starts new chain if condition met)
   *   chain₂ --> output  (starts new chain if condition met)
   *   ...
   *   chainₙ --> output  (condition not met, stops)
   */
  "daily-digest": {
    entry: true;
    input: { userId: string; iteration: number };
    output: { sentAt: string };
  };
  "health-check": {
    entry: true;
    input: { serviceId: string; checkNumber: number };
    output: { status: string; checkedAt: string };
  };

  /*
   * Workflow (sync-data):
   *   sync-data --> output
   */
  "sync-data": {
    entry: true;
    input: { sourceId: string };
    output: { syncedAt: string };
  };

  /*
   * Workflow (reminder):
   *   reminder --> output  (typically deferred for hours/days; can be triggered early)
   */
  reminder: {
    entry: true;
    input: { userId: string; message: string };
    output: { sentAt: string };
  };
}>();

// Using short intervals for demo purposes
const DIGEST_INTERVAL_MS = 200;
const HEALTH_CHECK_INTERVAL_MS = 150;
const SYNC_WINDOW_MS = 2_000;

const MAX_DIGEST_ITERATIONS = 3;
const MAX_HEALTH_CHECKS = 3;

// Simulation state
let userSubscribed = true;
let serviceRunning = true;

await using pg = await acquirePostgres("postgres:18", import.meta.url);
const sql = postgres(pg.connectionString, { max: 10 });

const stateProvider = createPostgresJsStateProvider({ sql });
const stateAdapter = await createPgStateAdapter({ stateProvider });
await stateAdapter.migrateToLatest();
const notifyProvider = createPostgresJsNotifyProvider({ sql });
const notifyAdapter = await createPgNotifyAdapter({ notifyProvider });

// Create schema for tracking
await sql.unsafe(`
  CREATE TABLE IF NOT EXISTS digest_logs (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    sent_at TIMESTAMP DEFAULT NOW()
  )
`);

await sql.unsafe(`
  CREATE TABLE IF NOT EXISTS health_logs (
    id SERIAL PRIMARY KEY,
    service_id TEXT NOT NULL,
    status TEXT NOT NULL,
    checked_at TIMESTAMP DEFAULT NOW()
  )
`);

await sql.unsafe(`
  CREATE TABLE IF NOT EXISTS sync_logs (
    id SERIAL PRIMARY KEY,
    source_id TEXT NOT NULL,
    synced_at TIMESTAMP DEFAULT NOW()
  )
`);

await sql.unsafe(`
  CREATE TABLE IF NOT EXISTS reminder_logs (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    message TEXT NOT NULL,
    sent_at TIMESTAMP DEFAULT NOW()
  )
`);

const client = await createClient({
  stateAdapter,
  notifyAdapter,
  jobTypes,
});

const worker = await createInProcessWorker({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      "daily-digest": {
        attemptHandler: async ({ job, complete }) => {
          console.log(
            `\n[daily-digest] Sending digest #${job.input.iteration} to user ${job.input.userId}`,
          );

          await new Promise((r) => setTimeout(r, 50));

          return complete(async ({ sql: txSql, transactionHooks }) => {
            await txSql.unsafe("INSERT INTO digest_logs (user_id) VALUES ($1)", [job.input.userId]);

            const shouldContinue = userSubscribed && job.input.iteration < MAX_DIGEST_ITERATIONS;

            if (shouldContinue) {
              console.log(`  Scheduling next digest in ${DIGEST_INTERVAL_MS}ms...`);
              await client.startChain({
                sql: txSql,
                transactionHooks,
                typeName: "daily-digest",
                input: { userId: job.input.userId, iteration: job.input.iteration + 1 },
                schedule: { afterMs: DIGEST_INTERVAL_MS },
              });
            } else {
              console.log(`  User unsubscribed or max iterations reached. Stopping.`);
            }

            return { sentAt: new Date().toISOString() };
          });
        },
      },

      "health-check": {
        attemptHandler: async ({ job, complete }) => {
          console.log(
            `\n[health-check] Check #${job.input.checkNumber} for ${job.input.serviceId}`,
          );

          const status = serviceRunning ? "healthy" : "stopped";
          console.log(`  Status: ${status}`);

          return complete(async ({ sql: txSql, transactionHooks }) => {
            await txSql.unsafe("INSERT INTO health_logs (service_id, status) VALUES ($1, $2)", [
              job.input.serviceId,
              status,
            ]);

            const shouldContinue = serviceRunning && job.input.checkNumber < MAX_HEALTH_CHECKS;

            if (shouldContinue) {
              console.log(`  Scheduling next check in ${HEALTH_CHECK_INTERVAL_MS}ms...`);
              await client.startChain({
                sql: txSql,
                transactionHooks,
                typeName: "health-check",
                input: {
                  serviceId: job.input.serviceId,
                  checkNumber: job.input.checkNumber + 1,
                },
                schedule: { afterMs: HEALTH_CHECK_INTERVAL_MS },
                deduplication: {
                  key: `health:${job.input.serviceId}`,
                  excludeChainIds: [job.chainId],
                },
              });
            } else {
              console.log(`  Service stopped or max checks reached. Stopping.`);
            }

            return { status, checkedAt: new Date().toISOString() };
          });
        },
      },

      "sync-data": {
        attemptHandler: async ({ job, complete }) => {
          console.log(`\n[sync-data] Syncing data from ${job.input.sourceId}`);

          await new Promise((r) => setTimeout(r, 100));

          return complete(async ({ sql: txSql }) => {
            await txSql.unsafe("INSERT INTO sync_logs (source_id) VALUES ($1)", [
              job.input.sourceId,
            ]);
            const syncedAt = new Date().toISOString();
            console.log(`  Sync completed at ${syncedAt}`);
            return { syncedAt };
          });
        },
      },

      reminder: {
        attemptHandler: async ({ job, complete }) =>
          complete(async ({ sql: txSql }) => {
            console.log(`\n[reminder] "${job.input.message}" for ${job.input.userId}`);
            await txSql.unsafe("INSERT INTO reminder_logs (user_id, message) VALUES ($1, $2)", [
              job.input.userId,
              job.input.message,
            ]);
            return { sentAt: new Date().toISOString() };
          }),
      },
    },
  }),
});

const stopWorker = await worker.start();

const waitForRows = async (
  countQuery: () => Promise<{ count: string }[]>,
  expected: number,
  timeoutMs = 10000,
) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const [{ count }] = await countQuery();
    if (Number(count) >= expected) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Timed out waiting for ${expected} rows`);
};

// Scenario 1: Recurring Daily Digest
console.log("\n--- Scenario 1: Recurring Daily Digest ---");
console.log("Each execution starts a new independent chain - no cron needed!\n");

userSubscribed = true;

await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (txSql) =>
    client.startChain({
      sql: txSql,
      transactionHooks,
      typeName: "daily-digest",
      input: { userId: "user-123", iteration: 1 },
    }),
  ),
);

await waitForRows(async () => {
  const result = await sql.unsafe<{ count: string }[]>(
    "SELECT COUNT(*) as count FROM digest_logs WHERE user_id = 'user-123'",
  );
  return result;
}, MAX_DIGEST_ITERATIONS);

const [digestCount] = await sql.unsafe<{ count: string }[]>(
  "SELECT COUNT(*) as count FROM digest_logs WHERE user_id = 'user-123'",
);

console.log("\n" + "-".repeat(40));
console.log("SCENARIO 1 COMPLETED");
console.log("-".repeat(40));
console.log(`Total digests sent: ${digestCount.count}`);
assert.equal(Number(digestCount.count), MAX_DIGEST_ITERATIONS);

// Scenario 2: Health Check with Deduplication
console.log("\n--- Scenario 2: Health Check with Deduplication ---");
console.log("Deduplication prevents duplicate recurring job instances.\n");

serviceRunning = true;

// Start first health check with deduplication
const healthChain1 = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (txSql) =>
    client.startChain({
      sql: txSql,
      transactionHooks,
      typeName: "health-check",
      input: { serviceId: "api-server", checkNumber: 1 },
      deduplication: {
        key: "health:api-server",
        scope: "incomplete", // Only one active instance at a time
      },
    }),
  ),
);
console.log(`Started health check chain: ${healthChain1.id}`);
console.log(`Deduplicated: ${healthChain1.deduplicated}`);
assert.equal(healthChain1.deduplicated, false);

// Try to start another health check - should be deduplicated
const healthChain2 = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (txSql) =>
    client.startChain({
      sql: txSql,
      transactionHooks,
      typeName: "health-check",
      input: { serviceId: "api-server", checkNumber: 1 },
      deduplication: {
        key: "health:api-server",
        scope: "incomplete",
      },
    }),
  ),
);
console.log(`\nAttempted duplicate health check: ${healthChain2.id}`);
console.log(`Deduplicated: ${healthChain2.deduplicated} (returned existing chain)`);
assert.equal(healthChain2.deduplicated, true);
assert.equal(healthChain2.id, healthChain1.id);

await waitForRows(async () => {
  const result = await sql.unsafe<{ count: string }[]>(
    "SELECT COUNT(*) as count FROM health_logs WHERE service_id = 'api-server'",
  );
  return result;
}, MAX_HEALTH_CHECKS);

const [healthCount] = await sql.unsafe<{ count: string }[]>(
  "SELECT COUNT(*) as count FROM health_logs WHERE service_id = 'api-server'",
);

console.log("\n" + "-".repeat(40));
console.log("SCENARIO 2 COMPLETED");
console.log("-".repeat(40));
console.log(`Total health checks: ${healthCount.count}`);
assert.equal(Number(healthCount.count), MAX_HEALTH_CHECKS);

// Scenario 3: Time-Windowed Deduplication
console.log("\n--- Scenario 3: Time-Windowed Deduplication ---");
console.log(`Rate-limiting syncs with ${SYNC_WINDOW_MS}ms window.\n`);

// First sync - should succeed
const sync1 = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (txSql) =>
    client.startChain({
      sql: txSql,
      transactionHooks,
      typeName: "sync-data",
      input: { sourceId: "db-primary" },
      deduplication: {
        key: "sync:db-primary",
        scope: "any",
        windowMs: SYNC_WINDOW_MS,
      },
    }),
  ),
);
console.log(`First sync started: ${sync1.id}`);
console.log(`Deduplicated: ${sync1.deduplicated}`);
assert.equal(sync1.deduplicated, false);

await client.awaitChain(sync1, { timeoutMs: 5000 });

// Second sync immediately after - should be deduplicated (within window)
const sync2 = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (txSql) =>
    client.startChain({
      sql: txSql,
      transactionHooks,
      typeName: "sync-data",
      input: { sourceId: "db-primary" },
      deduplication: {
        key: "sync:db-primary",
        scope: "any",
        windowMs: SYNC_WINDOW_MS,
      },
    }),
  ),
);
console.log(`\nSecond sync (within window): ${sync2.id}`);
console.log(`Deduplicated: ${sync2.deduplicated} (rate-limited)`);
assert.equal(sync2.deduplicated, true);

// Wait for window to expire
console.log(`\nWaiting ${SYNC_WINDOW_MS}ms for window to expire...`);
await new Promise((r) => setTimeout(r, SYNC_WINDOW_MS + 100));

// Third sync after window - should succeed
const sync3 = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (txSql) =>
    client.startChain({
      sql: txSql,
      transactionHooks,
      typeName: "sync-data",
      input: { sourceId: "db-primary" },
      deduplication: {
        key: "sync:db-primary",
        scope: "any",
        windowMs: SYNC_WINDOW_MS,
      },
    }),
  ),
);
console.log(`\nThird sync (after window): ${sync3.id}`);
console.log(`Deduplicated: ${sync3.deduplicated} (new chain created)`);
assert.equal(sync3.deduplicated, false);

await client.awaitChain(sync3, { timeoutMs: 5000 });

const [syncCount] = await sql.unsafe<{ count: string }[]>(
  "SELECT COUNT(*) as count FROM sync_logs WHERE source_id = 'db-primary'",
);

console.log("\n" + "-".repeat(40));
console.log("SCENARIO 3 COMPLETED");
console.log("-".repeat(40));
console.log(`Total syncs executed: ${syncCount.count} (2 out of 3 attempts)`);
assert.equal(Number(syncCount.count), 2);

// Scenario 4: Trigger a Scheduled Job Early
console.log("\n--- Scenario 4: Trigger a Scheduled Job Early ---");
console.log("Schedule a reminder for an hour from now, then trigger it immediately.\n");

const ONE_HOUR_MS = 60 * 60 * 1000;

const reminder = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (txSql) =>
    client.startChain({
      sql: txSql,
      transactionHooks,
      typeName: "reminder",
      input: { userId: "user-123", message: "Weekly standup starts soon" },
      schedule: { afterMs: ONE_HOUR_MS },
    }),
  ),
);
console.log(`Scheduled reminder ${reminder.id} for +1h`);

const scheduled = await client.getJob({ id: reminder.id });
console.log(`  scheduledAt: ${scheduled!.scheduledAt.toISOString()}`);

// Admin action: run it now
console.log(`\nTriggering reminder ${reminder.id}...`);
await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (txSql) => client.triggerJob({ sql: txSql, transactionHooks, id: reminder.id })),
);

await client.awaitChain(reminder, { timeoutMs: 5000 });

const [reminderCount] = await sql.unsafe<{ count: string }[]>(
  "SELECT COUNT(*) as count FROM reminder_logs WHERE user_id = 'user-123'",
);

console.log("\n" + "-".repeat(40));
console.log("SCENARIO 4 COMPLETED");
console.log("-".repeat(40));
console.log(`Reminders sent: ${reminderCount.count}`);
assert.equal(Number(reminderCount.count), 1);

await stopWorker();
await notifyAdapter.close();
await stateAdapter.close();
await sql.end();
