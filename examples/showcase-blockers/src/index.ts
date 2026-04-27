/**
 * Job Blockers Showcase
 *
 * Demonstrates how jobs can depend on other job chains to complete before starting.
 *
 * Scenarios:
 * 1. Fan-out/Fan-in: Multiple fetch jobs run in parallel, aggregate waits for all
 * 2. Fixed Slots: Job requires exactly two specific prerequisite jobs
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
   * Workflow (fan-out/fan-in):
   *   fetch-source[0] --+
   *   fetch-source[1] --+--> aggregate-data
   *   fetch-source[2] --+
   */
  "fetch-source": {
    entry: true;
    input: { sourceId: string; url: string };
    output: { sourceId: string; data: string };
  };
  "aggregate-data": {
    entry: true;
    input: { reportId: string };
    output: { reportId: string; totalSources: number; combinedData: string };
    blockers: [...{ typeName: "fetch-source" }[]];
  };

  /*
   * Workflow (fixed slots):
   *   validate-user --+
   *                   +--> perform-action
   *   load-config ----+
   */
  "validate-user": {
    entry: true;
    input: { userId: string };
    output: { userId: string; role: string };
  };
  "load-config": {
    entry: true;
    input: { configKey: string };
    output: { configKey: string; value: string };
  };
  "perform-action": {
    entry: true;
    input: { actionId: string };
    output: { actionId: string; result: string };
    blockers: [{ typeName: "validate-user" }, { typeName: "load-config" }];
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
  jobTypes,
});

const worker = await createInProcessWorker({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      "fetch-source": {
        attemptHandler: async ({ job, complete }) => {
          console.log(`[fetch-source] Fetching ${job.input.sourceId}...`);
          await new Promise((r) => setTimeout(r, 100));
          return complete(async () => ({
            sourceId: job.input.sourceId,
            data: `Data from ${job.input.sourceId}`,
          }));
        },
      },

      "aggregate-data": {
        attemptHandler: async ({ job, complete }) => {
          console.log(`[aggregate-data] Aggregating ${job.blockers.length} sources`);

          for (const blocker of job.blockers) {
            console.log(`  - ${blocker.output.sourceId}: "${blocker.output.data}"`);
          }

          return complete(async () => ({
            reportId: job.input.reportId,
            totalSources: job.blockers.length,
            combinedData: job.blockers.map((b) => b.output.data).join(" | "),
          }));
        },
      },

      "validate-user": {
        attemptHandler: async ({ job, complete }) => {
          console.log(`[validate-user] Validating ${job.input.userId}`);
          return complete(async () => ({ userId: job.input.userId, role: "admin" }));
        },
      },

      "load-config": {
        attemptHandler: async ({ job, complete }) => {
          console.log(`[load-config] Loading ${job.input.configKey}`);
          return complete(async () => ({ configKey: job.input.configKey, value: "production" }));
        },
      },

      "perform-action": {
        attemptHandler: async ({ job, complete }) => {
          const [userBlocker, configBlocker] = job.blockers;
          console.log(
            `[perform-action] User: ${userBlocker.output.role}, Config: ${configBlocker.output.value}`,
          );

          return complete(async () => ({
            actionId: job.input.actionId,
            result: `Completed by ${userBlocker.output.role} with ${configBlocker.output.value}`,
          }));
        },
      },
    },
  }),
});

const stopWorker = await worker.start();

// Scenario 1: Fan-out/Fan-in with variadic blockers
console.log("\n--- Scenario 1: Fan-out/Fan-in ---");
console.log("Three fetch jobs run in parallel, aggregate waits for all.\n");

const aggregateChain = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (txSql) => {
    const fetchBlockers = await client.startJobChains({
      sql: txSql,
      transactionHooks,
      items: [
        { typeName: "fetch-source", input: { sourceId: "users", url: "/users" } },
        { typeName: "fetch-source", input: { sourceId: "orders", url: "/orders" } },
        { typeName: "fetch-source", input: { sourceId: "products", url: "/products" } },
      ],
    });
    return client.startJobChain({
      sql: txSql,
      transactionHooks,
      typeName: "aggregate-data",
      input: { reportId: "report-001" },
      blockers: fetchBlockers,
    });
  }),
);

const result1 = await client.awaitJobChain(aggregateChain, { timeoutMs: 10000 });
console.log(`\nResult: ${result1.output.totalSources} sources → "${result1.output.combinedData}"`);
assert.equal(result1.output.totalSources, 3);
assert.equal(result1.output.reportId, "report-001");

// Scenario 2: Fixed blocker slots
console.log("\n--- Scenario 2: Fixed Blocker Slots ---");
console.log("Action requires exactly: validate-user + load-config.\n");

const actionChain = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (txSql) => {
    const [userBlocker, configBlocker] = await client.startJobChains({
      sql: txSql,
      transactionHooks,
      items: [
        { typeName: "validate-user", input: { userId: "user-123" } },
        { typeName: "load-config", input: { configKey: "settings" } },
      ],
    });
    return client.startJobChain({
      sql: txSql,
      transactionHooks,
      typeName: "perform-action",
      input: { actionId: "action-001" },
      blockers: [userBlocker, configBlocker],
    });
  }),
);

const result2 = await client.awaitJobChain(actionChain, { timeoutMs: 10000 });
console.log(`\nResult: "${result2.output.result}"`);
assert.equal(result2.output.actionId, "action-001");
assert.ok(result2.output.result.includes("admin"));
assert.ok(result2.output.result.includes("production"));

await stopWorker();
await notifyAdapter.close();
await stateAdapter.close();
await sql.end();
