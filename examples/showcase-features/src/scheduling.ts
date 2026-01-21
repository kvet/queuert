/**
 * Scheduling Showcase
 *
 * Demonstrates recurring job patterns without external cron:
 *
 * 1. RECURRING JOBS (daily-digest)
 *    - Loop chains with scheduled delays
 *    - Worker polls internally - no cron needed
 *
 * 2. DEDUPLICATION (health-check)
 *    - Prevent duplicate recurring job instances
 *    - strategy: 'completed' allows new chain after previous completes
 *
 * 3. TIME-WINDOWED (sync-data)
 *    - Rate-limit job creation with windowMs
 *
 * Key insight: Workers are long-running processes that poll for jobs internally.
 * No external cron job is needed. Jobs with a `schedule` won't be picked up
 * until their scheduled time arrives.
 */

import { createQueuertClient, createQueuertInProcessWorker, defineJobTypes } from "queuert";
import { SetupContext } from "./setup.js";

// ============================================================================
// Job Types
// ============================================================================

const jobTypes = defineJobTypes<{
  // Recurring job that loops to itself with scheduled delays
  "daily-digest": {
    entry: true;
    input: { userId: string; iteration: number };
    output: { unsubscribedAt: string; totalSent: number };
    continueWith: { typeName: "daily-digest" };
  };

  // Recurring job with deduplication to prevent duplicate instances
  "health-check": {
    entry: true;
    input: { serviceId: string; checkNumber: number };
    output: { stoppedAt: string; totalChecks: number };
    continueWith: { typeName: "health-check" };
  };

  // Job with time-windowed deduplication for rate limiting
  "sync-data": {
    entry: true;
    input: { sourceId: string };
    output: { syncedAt: string };
  };
}>();

// ============================================================================
// Configuration
// ============================================================================

// Using short intervals for demo purposes (real apps would use hours/days)
const DIGEST_INTERVAL_MS = 200; // Simulates 24 hours
const HEALTH_CHECK_INTERVAL_MS = 150; // Simulates 1 hour
const SYNC_WINDOW_MS = 500; // Rate limit window

const MAX_DIGEST_ITERATIONS = 3;
const MAX_HEALTH_CHECKS = 3;

// ============================================================================
// Simulation State
// ============================================================================

let userSubscribed = true;
let serviceRunning = true;

// ============================================================================
// Main Function
// ============================================================================

export async function runSchedulingShowcase(setup: SetupContext): Promise<void> {
  const { sql, stateAdapter, notifyAdapter, log, stateProvider } = setup;

  console.log("\n" + "=".repeat(60));
  console.log("SCHEDULING SHOWCASE: Recurring Jobs Without Cron");
  console.log("=".repeat(60));

  // Create schema for tracking
  await sql`
    CREATE TABLE IF NOT EXISTS digest_logs (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      sent_at TIMESTAMP DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS health_logs (
      id SERIAL PRIMARY KEY,
      service_id TEXT NOT NULL,
      status TEXT NOT NULL,
      checked_at TIMESTAMP DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS sync_logs (
      id SERIAL PRIMARY KEY,
      source_id TEXT NOT NULL,
      synced_at TIMESTAMP DEFAULT NOW()
    )
  `;

  // Create client
  const client = await createQueuertClient({
    stateAdapter,
    notifyAdapter,
    log,
    jobTypeRegistry: jobTypes,
  });

  // Create worker
  const worker = await createQueuertInProcessWorker({
    stateAdapter,
    notifyAdapter,
    log,
    jobTypeRegistry: jobTypes,
    jobTypeProcessors: {
      // =========================================================================
      // RECURRING JOB: Daily Digest
      // =========================================================================
      "daily-digest": {
        process: async ({ job, complete }) => {
          console.log(
            `\n[daily-digest] Sending digest #${job.input.iteration} to user ${job.input.userId}`,
          );

          // Simulate sending email
          await new Promise((r) => setTimeout(r, 50));

          return complete(async ({ sql: txSql, continueWith }) => {
            await txSql`
              INSERT INTO digest_logs (user_id) VALUES (${job.input.userId})
            `;

            // Check if user is still subscribed and we haven't hit max iterations
            const shouldContinue = userSubscribed && job.input.iteration < MAX_DIGEST_ITERATIONS;

            if (shouldContinue) {
              console.log(`  Scheduling next digest in ${DIGEST_INTERVAL_MS}ms...`);
              // LOOP: Continue to same job type with scheduled delay
              return continueWith({
                typeName: "daily-digest",
                input: { userId: job.input.userId, iteration: job.input.iteration + 1 },
                schedule: { afterMs: DIGEST_INTERVAL_MS },
              });
            }

            console.log(`  User unsubscribed or max iterations reached. Stopping.`);
            return {
              unsubscribedAt: new Date().toISOString(),
              totalSent: job.input.iteration,
            };
          });
        },
      },

      // =========================================================================
      // RECURRING JOB WITH DEDUPLICATION: Health Check
      // =========================================================================
      "health-check": {
        process: async ({ job, complete }) => {
          console.log(
            `\n[health-check] Check #${job.input.checkNumber} for ${job.input.serviceId}`,
          );

          // Simulate health check
          const status = serviceRunning ? "healthy" : "stopped";
          console.log(`  Status: ${status}`);

          return complete(async ({ sql: txSql, continueWith }) => {
            await txSql`
              INSERT INTO health_logs (service_id, status)
              VALUES (${job.input.serviceId}, ${status})
            `;

            const shouldContinue = serviceRunning && job.input.checkNumber < MAX_HEALTH_CHECKS;

            if (shouldContinue) {
              console.log(`  Scheduling next check in ${HEALTH_CHECK_INTERVAL_MS}ms...`);
              return continueWith({
                typeName: "health-check",
                input: {
                  serviceId: job.input.serviceId,
                  checkNumber: job.input.checkNumber + 1,
                },
                schedule: { afterMs: HEALTH_CHECK_INTERVAL_MS },
              });
            }

            console.log(`  Service stopped or max checks reached. Stopping.`);
            return {
              stoppedAt: new Date().toISOString(),
              totalChecks: job.input.checkNumber,
            };
          });
        },
      },

      // =========================================================================
      // TIME-WINDOWED DEDUPLICATION: Sync Data
      // =========================================================================
      "sync-data": {
        process: async ({ job, complete }) => {
          console.log(`\n[sync-data] Syncing data from ${job.input.sourceId}`);

          // Simulate sync operation
          await new Promise((r) => setTimeout(r, 100));

          return complete(async ({ sql: txSql }) => {
            await txSql`
              INSERT INTO sync_logs (source_id) VALUES (${job.input.sourceId})
            `;
            const syncedAt = new Date().toISOString();
            console.log(`  Sync completed at ${syncedAt}`);
            return { syncedAt };
          });
        },
      },
    },
  });

  const stopWorker = await worker.start();

  // =========================================================================
  // Scenario 1: Recurring Daily Digest
  // =========================================================================
  console.log("\n" + "-".repeat(40));
  console.log("SCENARIO 1: Recurring Daily Digest");
  console.log("-".repeat(40));
  console.log("Job loops to itself with scheduled delays - no cron needed!");

  userSubscribed = true;

  const digestChain = await client.withNotify(async () =>
    stateProvider.runInTransaction(async (txContext) =>
      client.startJobChain({
        ...txContext,
        typeName: "daily-digest",
        input: { userId: "user-123", iteration: 1 },
      }),
    ),
  );

  const digestResult = await client.waitForJobChainCompletion(digestChain, {
    timeoutMs: 10000,
  });

  const [digestCount] = await sql<{ count: string }[]>`
    SELECT COUNT(*) as count FROM digest_logs WHERE user_id = 'user-123'
  `;

  console.log("\n" + "-".repeat(40));
  console.log("SCENARIO 1 COMPLETED");
  console.log("-".repeat(40));
  console.log(`Total digests sent: ${digestCount.count}`);
  console.log(`Final result: ${JSON.stringify(digestResult.output)}`);

  // =========================================================================
  // Scenario 2: Health Check with Deduplication
  // =========================================================================
  console.log("\n" + "-".repeat(40));
  console.log("SCENARIO 2: Health Check with Deduplication");
  console.log("-".repeat(40));
  console.log("Deduplication prevents duplicate recurring job instances.");

  serviceRunning = true;

  // Start first health check with deduplication
  const healthChain1 = await client.withNotify(async () =>
    stateProvider.runInTransaction(async (txContext) =>
      client.startJobChain({
        ...txContext,
        typeName: "health-check",
        input: { serviceId: "api-server", checkNumber: 1 },
        deduplication: {
          key: "health:api-server",
          strategy: "completed", // Only one active instance at a time
        },
      }),
    ),
  );
  console.log(`\nStarted health check chain: ${healthChain1.id}`);
  console.log(`Deduplicated: ${healthChain1.deduplicated}`);

  // Try to start another health check - should be deduplicated
  const healthChain2 = await client.withNotify(async () =>
    stateProvider.runInTransaction(async (txContext) =>
      client.startJobChain({
        ...txContext,
        typeName: "health-check",
        input: { serviceId: "api-server", checkNumber: 1 },
        deduplication: {
          key: "health:api-server",
          strategy: "completed",
        },
      }),
    ),
  );
  console.log(`\nAttempted duplicate health check: ${healthChain2.id}`);
  console.log(`Deduplicated: ${healthChain2.deduplicated} (returned existing chain)`);

  const healthResult = await client.waitForJobChainCompletion(healthChain1, {
    timeoutMs: 10000,
  });

  const [healthCount] = await sql<{ count: string }[]>`
    SELECT COUNT(*) as count FROM health_logs WHERE service_id = 'api-server'
  `;

  console.log("\n" + "-".repeat(40));
  console.log("SCENARIO 2 COMPLETED");
  console.log("-".repeat(40));
  console.log(`Total health checks: ${healthCount.count}`);
  console.log(`Final result: ${JSON.stringify(healthResult.output)}`);

  // =========================================================================
  // Scenario 3: Time-Windowed Deduplication
  // =========================================================================
  console.log("\n" + "-".repeat(40));
  console.log("SCENARIO 3: Time-Windowed Deduplication");
  console.log("-".repeat(40));
  console.log(`Rate-limiting syncs with ${SYNC_WINDOW_MS}ms window.`);

  // First sync - should succeed
  const sync1 = await client.withNotify(async () =>
    stateProvider.runInTransaction(async (txContext) =>
      client.startJobChain({
        ...txContext,
        typeName: "sync-data",
        input: { sourceId: "db-primary" },
        deduplication: {
          key: "sync:db-primary",
          strategy: "all",
          windowMs: SYNC_WINDOW_MS,
        },
      }),
    ),
  );
  console.log(`\nFirst sync started: ${sync1.id}`);
  console.log(`Deduplicated: ${sync1.deduplicated}`);

  await client.waitForJobChainCompletion(sync1, { timeoutMs: 5000 });

  // Second sync immediately after - should be deduplicated (within window)
  const sync2 = await client.withNotify(async () =>
    stateProvider.runInTransaction(async (txContext) =>
      client.startJobChain({
        ...txContext,
        typeName: "sync-data",
        input: { sourceId: "db-primary" },
        deduplication: {
          key: "sync:db-primary",
          strategy: "all",
          windowMs: SYNC_WINDOW_MS,
        },
      }),
    ),
  );
  console.log(`\nSecond sync (within window): ${sync2.id}`);
  console.log(`Deduplicated: ${sync2.deduplicated} (rate-limited)`);

  // Wait for window to expire
  console.log(`\nWaiting ${SYNC_WINDOW_MS}ms for window to expire...`);
  await new Promise((r) => setTimeout(r, SYNC_WINDOW_MS + 100));

  // Third sync after window - should succeed
  const sync3 = await client.withNotify(async () =>
    stateProvider.runInTransaction(async (txContext) =>
      client.startJobChain({
        ...txContext,
        typeName: "sync-data",
        input: { sourceId: "db-primary" },
        deduplication: {
          key: "sync:db-primary",
          strategy: "all",
          windowMs: SYNC_WINDOW_MS,
        },
      }),
    ),
  );
  console.log(`\nThird sync (after window): ${sync3.id}`);
  console.log(`Deduplicated: ${sync3.deduplicated} (new chain created)`);

  await client.waitForJobChainCompletion(sync3, { timeoutMs: 5000 });

  const [syncCount] = await sql<{ count: string }[]>`
    SELECT COUNT(*) as count FROM sync_logs WHERE source_id = 'db-primary'
  `;

  console.log("\n" + "-".repeat(40));
  console.log("SCENARIO 3 COMPLETED");
  console.log("-".repeat(40));
  console.log(`Total syncs executed: ${syncCount.count} (2 out of 3 attempts)`);

  await stopWorker();
}
