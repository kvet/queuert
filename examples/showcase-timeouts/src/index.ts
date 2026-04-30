/**
 * Timeouts Showcase
 *
 * Demonstrates timeout patterns for job processing.
 *
 * Scenarios:
 * 1. Cooperative Timeout: Using AbortSignal.timeout() with the job signal
 * 2. Hard Timeout: Using leaseConfig for automatic job reclamation
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
  // Job with cooperative timeout
  "fetch-with-timeout": {
    entry: true;
    input: { url: string; timeoutMs: number };
    output: { data: string } | { timedOut: true };
  };

  // Job demonstrating hard timeout via lease
  "long-running-job": {
    entry: true;
    input: { taskId: string; durationMs: number };
    output: { completed: true; attempt: number };
  };
}>();

async function simulatedFetch(url: string, signal: AbortSignal, delayMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timeout = setTimeout(() => {
      resolve(`Data from ${url}`);
    }, delayMs);
    signal.addEventListener("abort", () => {
      clearTimeout(timeout);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
}

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

const worker = await createInProcessWorker({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      "fetch-with-timeout": {
        attemptHandler: async ({ signal, job, complete }) => {
          console.log(
            `[fetch-with-timeout] Fetching ${job.input.url} (timeout: ${job.input.timeoutMs}ms)`,
          );

          const timeout = AbortSignal.timeout(job.input.timeoutMs);
          const combined = AbortSignal.any([signal, timeout]);

          try {
            const data = await simulatedFetch(job.input.url, combined, 300);
            console.log(`  Fetch SUCCESS`);
            return await complete(async () => ({ data }));
          } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") {
              console.log(`  Fetch TIMED OUT`);
              return complete(async () => ({ timedOut: true }));
            }
            throw error;
          }
        },
      },

      "long-running-job": {
        // Configure shorter lease for demo (normally you'd use longer values)
        leaseConfig: { leaseMs: 500, renewIntervalMs: 200 },
        attemptHandler: async ({ job, complete }) => {
          const attempt = job.attempt;
          console.log(
            `[long-running-job] Task ${job.input.taskId}, attempt ${attempt}, duration ${job.input.durationMs}ms`,
          );

          await new Promise((r) => setTimeout(r, job.input.durationMs));

          console.log(`  Task completed on attempt ${attempt}`);
          return complete(async () => ({ completed: true, attempt }));
        },
      },
    },
  }),
});

const stopWorker = await worker.start();

// Scenario 1a: Cooperative timeout - completes in time
console.log("\n--- Scenario 1a: Cooperative Timeout (Success) ---");
console.log("Fetch completes before timeout.\n");

const fetch1 = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (txSql) =>
    client.startChain({
      sql: txSql,
      transactionHooks,
      typeName: "fetch-with-timeout",
      input: { url: "/api/fast", timeoutMs: 500 }, // 500ms timeout, 300ms fetch
    }),
  ),
);
const result1 = await client.awaitChain(fetch1, { timeoutMs: 5000 });
console.log(`Result: ${JSON.stringify(result1.output)}`);
assert.ok("data" in result1.output);

// Scenario 1b: Cooperative timeout - times out
console.log("\n--- Scenario 1b: Cooperative Timeout (Timeout) ---");
console.log("Fetch times out before completing.\n");

const fetch2 = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (txSql) =>
    client.startChain({
      sql: txSql,
      transactionHooks,
      typeName: "fetch-with-timeout",
      input: { url: "/api/slow", timeoutMs: 100 }, // 100ms timeout, 300ms fetch
    }),
  ),
);
const result2 = await client.awaitChain(fetch2, { timeoutMs: 5000 });
console.log(`Result: ${JSON.stringify(result2.output)}`);
assert.ok("timedOut" in result2.output);

// Scenario 2: Hard timeout via lease (completes in time)
console.log("\n--- Scenario 2: Hard Timeout via Lease ---");
console.log("Job with leaseConfig completes within lease period.\n");

const longChain = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (txSql) =>
    client.startChain({
      sql: txSql,
      transactionHooks,
      typeName: "long-running-job",
      input: { taskId: "task-001", durationMs: 200 }, // 200ms work, 500ms lease
    }),
  ),
);
const result3 = await client.awaitChain(longChain, { timeoutMs: 5000 });
console.log(`Result: ${JSON.stringify(result3.output)}`);
assert.ok("completed" in result3.output);
assert.equal(result3.output.attempt, 1);

await stopWorker();
await notifyAdapter.close();
await stateAdapter.close();
await sql.end();
