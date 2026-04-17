/**
 * Multi-Worker Prioritization Showcase
 *
 * Queuert has no built-in priority field. Prioritization is a consequence of
 * partitioning workloads across workers: each worker owns a subset of job
 * types, and its capacity is reserved for that workload. Urgent work gets its
 * own worker and can't wait behind a long bulk backlog.
 *
 * Scenarios:
 *   1. Reserved capacity: 10 bulk (marketing) jobs are enqueued first, then 3
 *      urgent (transactional) jobs arrive. The urgent worker picks them up
 *      immediately because it never observes marketing jobs.
 *   2. Cross-worker chain handoff: a chain starts on the urgent worker
 *      (alert.dispatch) and continues on the bulk worker (alert.archive).
 *      Chains are not bound to a single worker — continueWith hands off
 *      through the database.
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
  createJobTypeProcessorRegistry,
  defineJobTypeRegistry,
  withTransactionHooks,
} from "queuert";

const jobTypeRegistry = defineJobTypeRegistry<{
  /*
   * Workload layout (each worker's registry is a subset of the client's):
   *
   *   email.transactional  --+
   *                          |--> urgent worker (concurrency 3)
   *   alert.dispatch       --+          |
   *                                     v (continueWith — crosses workers)
   *   alert.archive        --+          |
   *                          |<---------+
   *   email.marketing      --+--> bulk worker (concurrency 1)
   */
  "email.transactional": {
    entry: true;
    input: { to: string; subject: string };
    output: { finishedAt: number };
  };
  "email.marketing": {
    entry: true;
    input: { to: string; subject: string };
    output: { finishedAt: number };
  };
  "alert.dispatch": {
    entry: true;
    input: { to: string; alertId: string };
    continueWith: { typeName: "alert.archive" };
  };
  "alert.archive": {
    input: { to: string; alertId: string };
    output: { archivedAt: number };
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
  jobTypeRegistry,
});

const startedAt = Date.now();
const completionOrder: { worker: "urgent" | "bulk"; label: string; elapsedMs: number }[] = [];

const simulateWork = async (durationMs: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, durationMs));
};

const urgentWorker = await createInProcessWorker({
  client,
  workerId: "urgent-worker",
  concurrency: 3,
  jobTypeProcessorRegistry: createJobTypeProcessorRegistry({
    client,
    jobTypeRegistry,
    processors: {
      "email.transactional": {
        attemptHandler: async ({ job, complete }) => {
          await simulateWork(50);
          return complete(async () => {
            const elapsedMs = Date.now() - startedAt;
            completionOrder.push({
              worker: "urgent",
              label: `send ${job.input.to}`,
              elapsedMs,
            });
            console.log(`[urgent] send ${job.input.to} done at +${elapsedMs}ms`);
            return { finishedAt: Date.now() };
          });
        },
      },
      "alert.dispatch": {
        attemptHandler: async ({ job, complete }) => {
          await simulateWork(50);
          return complete(async ({ continueWith }) => {
            const elapsedMs = Date.now() - startedAt;
            completionOrder.push({
              worker: "urgent",
              label: `dispatch ${job.input.alertId}`,
              elapsedMs,
            });
            console.log(
              `[urgent] dispatch ${job.input.alertId} done at +${elapsedMs}ms → hands off to bulk worker`,
            );
            return continueWith({
              typeName: "alert.archive",
              input: { to: job.input.to, alertId: job.input.alertId },
            });
          });
        },
      },
    },
  }),
});

const bulkWorker = await createInProcessWorker({
  client,
  workerId: "bulk-worker",
  concurrency: 1,
  jobTypeProcessorRegistry: createJobTypeProcessorRegistry({
    client,
    jobTypeRegistry,
    processors: {
      "email.marketing": {
        attemptHandler: async ({ job, complete }) => {
          await simulateWork(800);
          return complete(async () => {
            const elapsedMs = Date.now() - startedAt;
            completionOrder.push({ worker: "bulk", label: `send ${job.input.to}`, elapsedMs });
            console.log(`[bulk  ] send ${job.input.to} done at +${elapsedMs}ms`);
            return { finishedAt: Date.now() };
          });
        },
      },
      "alert.archive": {
        attemptHandler: async ({ job, complete }) => {
          await simulateWork(800);
          return complete(async () => {
            const elapsedMs = Date.now() - startedAt;
            completionOrder.push({
              worker: "bulk",
              label: `archive ${job.input.alertId}`,
              elapsedMs,
            });
            console.log(`[bulk  ] archive ${job.input.alertId} done at +${elapsedMs}ms`);
            return { archivedAt: Date.now() };
          });
        },
      },
    },
  }),
});

const stopUrgent = await urgentWorker.start();
const stopBulk = await bulkWorker.start();

// --- Scenario 1: urgent jobs overtake a long bulk backlog thanks to reserved capacity ---

console.log("\n--- Scenario 1: Reserved Capacity ---");
console.log(
  "10 bulk (marketing) jobs enqueued first, then 3 urgent (transactional) jobs arrive.\n",
);

const marketingChains = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (txSql) =>
    client.startJobChains({
      sql: txSql,
      transactionHooks,
      items: Array.from({ length: 10 }, (_, index) => ({
        typeName: "email.marketing" as const,
        input: { to: `digest-${index}@example.com`, subject: "Weekly digest" },
      })),
    }),
  ),
);

await new Promise((resolve) => setTimeout(resolve, 50));

const transactionalChains = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (txSql) =>
    client.startJobChains({
      sql: txSql,
      transactionHooks,
      items: [
        {
          typeName: "email.transactional",
          input: { to: "alice@example.com", subject: "Password reset" },
        },
        {
          typeName: "email.transactional",
          input: { to: "bob@example.com", subject: "Login from new device" },
        },
        {
          typeName: "email.transactional",
          input: { to: "carol@example.com", subject: "2FA code" },
        },
      ],
    }),
  ),
);

await Promise.all([
  ...transactionalChains.map(async (chain) => client.awaitJobChain(chain, { timeoutMs: 30_000 })),
  ...marketingChains.map(async (chain) => client.awaitJobChain(chain, { timeoutMs: 30_000 })),
]);

console.log("\nCompletion order:");
for (const entry of completionOrder) {
  console.log(
    `  +${entry.elapsedMs.toString().padStart(5, " ")}ms  [${entry.worker}] ${entry.label}`,
  );
}

const urgentFinished = completionOrder.filter((entry) => entry.worker === "urgent");
const lastUrgentAt = urgentFinished[urgentFinished.length - 1].elapsedMs;
const bulkCompletedAfterLastUrgent = completionOrder.filter(
  (entry) => entry.worker === "bulk" && entry.elapsedMs > lastUrgentAt,
).length;

assert.equal(urgentFinished.length, 3, "all 3 urgent jobs must complete");
assert.ok(
  completionOrder.slice(0, 3).every((entry) => entry.worker === "urgent"),
  "the first 3 completions should all be urgent — reserved capacity let them overtake the bulk backlog",
);
assert.ok(
  bulkCompletedAfterLastUrgent >= 8,
  "the bulk worker should still be draining its backlog when the last urgent job finishes",
);

// --- Scenario 2: one chain hands off from the urgent worker to the bulk worker ---

console.log("\n--- Scenario 2: Cross-Worker Chain Handoff ---");
console.log(
  "A chain begins on the urgent worker (alert.dispatch) and continues on the bulk worker (alert.archive).\n",
);

const alertChain = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (txSql) =>
    client.startJobChain({
      sql: txSql,
      transactionHooks,
      typeName: "alert.dispatch",
      input: { to: "oncall@example.com", alertId: "ALT-42" },
    }),
  ),
);

const alertResult = await client.awaitJobChain(alertChain, { timeoutMs: 30_000 });

assert.equal(typeof alertResult.output.archivedAt, "number");

const dispatchEntry = completionOrder.find((entry) => entry.label === "dispatch ALT-42");
const archiveEntry = completionOrder.find((entry) => entry.label === "archive ALT-42");
assert.ok(dispatchEntry, "dispatch step must have run on the urgent worker");
assert.ok(archiveEntry, "archive step must have run on the bulk worker");
assert.equal(dispatchEntry.worker, "urgent");
assert.equal(archiveEntry.worker, "bulk");
assert.ok(
  archiveEntry.elapsedMs > dispatchEntry.elapsedMs,
  "archive must run after dispatch — continueWith hands the chain off through the DB",
);

await stopUrgent();
await stopBulk();
await sql.end();
