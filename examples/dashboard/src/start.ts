/**
 * Job Populator
 *
 * Populates the shared SQLite database for the dashboard to display: five labelled
 * demo scenarios (single job, continuations, blockers, retries, scheduled) followed
 * by bulk volume that exceeds the dashboard's 100/page size so every list paginates —
 * a long single chain, a pending chain that blocks many jobs, and many root chains.
 *
 * Volume is env-tunable: SEED_CHAIN_STEPS, SEED_BLOCKED, SEED_GREET, SEED_ORDER, and
 * SEED_DRAIN_MS (how long to let the worker process before stopping). Defaults exceed
 * 100; set them to 0 for a lightweight run.
 *
 * Usage: bun run start
 * Then open http://localhost:3333 to view results in the dashboard.
 */

import { createInProcessWorker, createProcessors, withTransactionHooks } from "queuert";

import { client, db, jobTypes, notifyAdapter, stateAdapter } from "./client.js";

const stepCount = Number(process.env.SEED_CHAIN_STEPS ?? 120);
const blockedCount = Number(process.env.SEED_BLOCKED ?? 130);
const greetCount = Number(process.env.SEED_GREET ?? 130);
const orderCount = Number(process.env.SEED_ORDER ?? 60);
const drainMs = Number(process.env.SEED_DRAIN_MS ?? 8000);

const worker = await createInProcessWorker({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      greet: {
        attemptHandler: async ({ job, complete }) => {
          await delay(20);
          return complete(async () => ({
            greeting: `Hello, ${job.input.name}!`,
          }));
        },
      },

      "order:validate": {
        attemptHandler: async ({ job, complete }) => {
          await delay(50);
          return complete(async ({ continueWith }) =>
            continueWith({
              typeName: "order:process",
              input: { orderId: job.input.orderId, validated: true },
            }),
          );
        },
      },
      "order:process": {
        attemptHandler: async ({ job, complete }) => {
          await delay(100);
          return complete(async ({ continueWith }) =>
            continueWith({
              typeName: "order:complete",
              input: { orderId: job.input.orderId, processed: true },
            }),
          );
        },
      },
      "order:complete": {
        attemptHandler: async ({ job, complete }) => {
          await delay(30);
          return complete(async () => ({
            orderId: job.input.orderId,
            status: "completed",
          }));
        },
      },

      "fetch-user": {
        attemptHandler: async ({ job, complete }) => {
          await delay(80);
          return complete(async () => ({
            userId: job.input.userId,
            name: "Alice",
          }));
        },
      },
      "fetch-permissions": {
        attemptHandler: async ({ job, complete }) => {
          await delay(60);
          return complete(async () => ({
            userId: job.input.userId,
            permissions: ["read", "write"],
          }));
        },
      },
      "process-with-blockers": {
        attemptHandler: async ({ job, complete }) => {
          const [userBlocker, permBlocker] = job.blockers;
          await delay(40);
          return complete(async () => ({
            taskId: job.input.taskId,
            result: `${userBlocker.output.name} has ${permBlocker.output.permissions.join(", ")}`,
          }));
        },
      },

      "might-fail": {
        attemptHandler: async ({ job, complete }) => {
          if (job.input.shouldFail && job.attempt < 2) {
            throw new Error("Simulated failure");
          }
          return complete(async () => ({ success: true as const }));
        },
        backoffConfig: { initialDelayMs: 100, maxDelayMs: 100 },
      },

      "scheduled-report": {
        attemptHandler: async ({ complete }) => {
          await delay(50);
          return complete(async () => ({
            generatedAt: new Date().toISOString(),
          }));
        },
      },

      "count-step": {
        attemptHandler: async ({ job, complete }) =>
          complete(async ({ continueWith }) => {
            if (job.input.n >= job.input.total) {
              return { total: job.input.total };
            }
            return continueWith({
              typeName: "count-step",
              input: { n: job.input.n + 1, total: job.input.total },
            });
          }),
      },

      signal: {
        attemptHandler: async ({ complete }) => complete(async () => ({ fired: true as const })),
      },

      "blocked-task": {
        attemptHandler: async ({ job, complete }) =>
          complete(async () => ({ index: job.input.index, done: true as const })),
      },
    },
  }),
});

const stopWorker = await worker.start();

console.log("\n=== Dashboard Job Populator ===\n");

// Scenario 1: Single Job
console.log("--- Scenario 1: Single Job ---");
const greetChain = await withTransactionHooks(async (transactionHooks) =>
  stateAdapter.withTransaction(async (ctx) =>
    client.startChain({ ...ctx, transactionHooks, typeName: "greet", input: { name: "World" } }),
  ),
);
const greetResult = await client.awaitChain(greetChain, { timeoutMs: 5000 });
console.log("Result:", greetResult.output);

// Scenario 2: Continuations
console.log("\n--- Scenario 2: Continuations ---");
const orderChain = await withTransactionHooks(async (transactionHooks) =>
  stateAdapter.withTransaction(async (ctx) =>
    client.startChain({
      ...ctx,
      transactionHooks,
      typeName: "order:validate",
      input: { orderId: "ORD-123" },
    }),
  ),
);
const orderResult = await client.awaitChain(orderChain, { timeoutMs: 10000 });
console.log("Result:", orderResult.output);

// Scenario 3: Blockers (fan-out/fan-in)
console.log("\n--- Scenario 3: Blockers ---");
const blockerChain = await withTransactionHooks(async (transactionHooks) =>
  stateAdapter.withTransaction(async (ctx) => {
    const userBlocker = await client.startChain({
      ...ctx,
      transactionHooks,
      typeName: "fetch-user",
      input: { userId: "user-1" },
    });
    const permBlocker = await client.startChain({
      ...ctx,
      transactionHooks,
      typeName: "fetch-permissions",
      input: { userId: "user-1" },
    });
    return client.startChain({
      ...ctx,
      transactionHooks,
      typeName: "process-with-blockers",
      input: { taskId: "TASK-456" },
      blockers: [userBlocker, permBlocker],
    });
  }),
);
const blockerResult = await client.awaitChain(blockerChain, { timeoutMs: 10000 });
console.log("Result:", blockerResult.output);

// Scenario 4: Retries
console.log("\n--- Scenario 4: Retries ---");
const retryChain = await withTransactionHooks(async (transactionHooks) =>
  stateAdapter.withTransaction(async (ctx) =>
    client.startChain({
      ...ctx,
      transactionHooks,
      typeName: "might-fail",
      input: { shouldFail: true },
    }),
  ),
);
const retryResult = await client.awaitChain(retryChain, { timeoutMs: 5000 });
console.log("Result:", retryResult.output);

// Scenario 5: Scheduled Job (1 hour in the future — trigger it from the dashboard)
console.log("\n--- Scenario 5: Scheduled Job ---");
await withTransactionHooks(async (transactionHooks) =>
  stateAdapter.withTransaction(async (ctx) =>
    client.startChain({
      ...ctx,
      transactionHooks,
      typeName: "scheduled-report",
      input: { reportType: "daily-summary" },
      schedule: { afterMs: 60 * 60 * 1000 },
    }),
  ),
);
console.log('Created scheduled-report (in 1 hour). Use "Reschedule" in the dashboard!');

// Scenario 6: Long chain — one chain with many jobs (chain-detail job pagination)
console.log("\n--- Scenario 6: Long chain ---");
const longChain = await withTransactionHooks(async (transactionHooks) =>
  stateAdapter.withTransaction(async (ctx) =>
    client.startChain({
      ...ctx,
      transactionHooks,
      typeName: "count-step",
      input: { n: 1, total: stepCount },
    }),
  ),
);
await client.awaitChain(longChain, { timeoutMs: 60000 });
console.log(`Built a ${stepCount}-job chain (id ${longChain.id}).`);

// Scenario 7: Blocker fan-in — one pending chain blocking many jobs (chain-detail "Blocking" pagination)
console.log("\n--- Scenario 7: Blocker fan-in ---");
const hub = await withTransactionHooks(async (transactionHooks) =>
  stateAdapter.withTransaction(async (ctx) =>
    client.startChain({
      ...ctx,
      transactionHooks,
      typeName: "signal",
      input: { name: "release-gate" },
      // Scheduled far ahead so it never fires here — its dependents stay blocked.
      schedule: { afterMs: 60 * 60 * 1000 },
    }),
  ),
);
await withTransactionHooks(async (transactionHooks) =>
  stateAdapter.withTransaction(async (ctx) =>
    client.startChains({
      ...ctx,
      transactionHooks,
      items: Array.from({ length: blockedCount }, (_, index) => ({
        typeName: "blocked-task" as const,
        input: { index },
        blockers: [hub],
      })),
    }),
  ),
);
console.log(`Created ${blockedCount} jobs blocked by chain ${hub.id}.`);

// Scenario 8: Bulk volume — many root chains/jobs (chain-list + job-list pagination)
console.log("\n--- Scenario 8: Bulk volume ---");
await withTransactionHooks(async (transactionHooks) =>
  stateAdapter.withTransaction(async (ctx) =>
    client.startChains({
      ...ctx,
      transactionHooks,
      items: Array.from({ length: greetCount }, (_, index) => ({
        typeName: "greet" as const,
        input: { name: `User ${index + 1}` },
      })),
    }),
  ),
);
await withTransactionHooks(async (transactionHooks) =>
  stateAdapter.withTransaction(async (ctx) =>
    client.startChains({
      ...ctx,
      transactionHooks,
      items: Array.from({ length: orderCount }, (_, index) => ({
        typeName: "order:validate" as const,
        input: { orderId: `ORD-${1000 + index}` },
      })),
    }),
  ),
);
console.log(
  `Created ${greetCount} greet + ${orderCount} order chains; draining for ${drainMs}ms...`,
);

// Let the worker process a chunk so the lists show a mix of completed/pending jobs.
await delay(drainMs);

// Cleanup
await stopWorker();
await notifyAdapter.close();
await stateAdapter.close();
db.close();

console.log("\nDone! Open http://localhost:3333 to view the dashboard.");

async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
