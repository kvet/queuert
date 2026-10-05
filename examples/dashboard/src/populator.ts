/**
 * Job Populator
 *
 * Populates the shared SQLite database for the dashboard to display
 *
 * Usage: bun run start
 * Then open http://localhost:3333 to view results in the dashboard.
 */

import { createInProcessWorker, createProcessors, withTransactionHooks } from "queuert";

import { client, db, jobTypes, notifyAdapter, stateAdapter } from "./common.js";

const DASHBOARD_PAGE_SIZE = 100;
const delay = async (ms: number) => {
  return new Promise((r) => setTimeout(r, ms));
};

const worker = await createInProcessWorker({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      greet: {
        attemptHandler: async ({ job, finish }) => {
          await delay(20);
          return withTransactionHooks(async (transactionHooks) =>
            stateAdapter.withTransaction(async (ctx) =>
              finish({
                ...ctx,
                transactionHooks,
                output: {
                  greeting: `Hello, ${job.input.name}!`,
                },
              }),
            ),
          );
        },
      },

      "order:validate": {
        attemptHandler: async ({ job, finish }) => {
          await delay(50);
          return withTransactionHooks(async (transactionHooks) =>
            stateAdapter.withTransaction(async (ctx) =>
              finish({
                ...ctx,
                transactionHooks,
                continueWith: {
                  typeName: "order:process",
                  input: { orderId: job.input.orderId, validated: true },
                },
              }),
            ),
          );
        },
      },
      "order:process": {
        attemptHandler: async ({ job, finish }) => {
          await delay(100);
          return withTransactionHooks(async (transactionHooks) =>
            stateAdapter.withTransaction(async (ctx) =>
              finish({
                ...ctx,
                transactionHooks,
                continueWith: {
                  typeName: "order:complete",
                  input: { orderId: job.input.orderId, processed: true },
                },
              }),
            ),
          );
        },
      },
      "order:complete": {
        attemptHandler: async ({ job, finish }) => {
          await delay(30);
          return withTransactionHooks(async (transactionHooks) =>
            stateAdapter.withTransaction(async (ctx) =>
              finish({
                ...ctx,
                transactionHooks,
                output: {
                  orderId: job.input.orderId,
                  status: "completed",
                },
              }),
            ),
          );
        },
      },

      "fetch-user": {
        attemptHandler: async ({ job, finish }) => {
          await delay(80);
          return withTransactionHooks(async (transactionHooks) =>
            stateAdapter.withTransaction(async (ctx) =>
              finish({
                ...ctx,
                transactionHooks,
                output: {
                  userId: job.input.userId,
                  name: "Alice",
                },
              }),
            ),
          );
        },
      },
      "fetch-permissions": {
        attemptHandler: async ({ job, finish }) => {
          await delay(60);
          return withTransactionHooks(async (transactionHooks) =>
            stateAdapter.withTransaction(async (ctx) =>
              finish({
                ...ctx,
                transactionHooks,
                output: {
                  userId: job.input.userId,
                  permissions: ["read", "write"],
                },
              }),
            ),
          );
        },
      },
      "process-with-blockers": {
        attemptHandler: async ({ job, getBlockers, finish }) => {
          const [userBlocker, permBlocker] = await getBlockers();
          await delay(40);
          return withTransactionHooks(async (transactionHooks) =>
            stateAdapter.withTransaction(async (ctx) =>
              finish({
                ...ctx,
                transactionHooks,
                output: {
                  taskId: job.input.taskId,
                  result: `${userBlocker.output.name} has ${permBlocker.output.permissions.join(", ")}`,
                },
              }),
            ),
          );
        },
      },

      "might-fail": {
        attemptHandler: async ({ job, finish }) => {
          if (job.input.shouldFail && job.attempt < 2) {
            throw new Error("Simulated failure");
          }
          return withTransactionHooks(async (transactionHooks) =>
            stateAdapter.withTransaction(async (ctx) =>
              finish({ ...ctx, transactionHooks, output: { success: true } }),
            ),
          );
        },
        backoffConfig: { initialDelayMs: 100, maxDelayMs: 100 },
      },

      "scheduled-report": {
        attemptHandler: async ({ finish }) => {
          await delay(50);
          return withTransactionHooks(async (transactionHooks) =>
            stateAdapter.withTransaction(async (ctx) =>
              finish({
                ...ctx,
                transactionHooks,
                output: {
                  generatedAt: new Date().toISOString(),
                },
              }),
            ),
          );
        },
      },

      "count-step": {
        attemptHandler: async ({ job, finish }) =>
          withTransactionHooks(async (transactionHooks) =>
            stateAdapter.withTransaction(async (ctx) => {
              if (job.input.n >= job.input.total) {
                return finish({ ...ctx, transactionHooks, output: { total: job.input.total } });
              }
              return finish({
                ...ctx,
                transactionHooks,
                continueWith: {
                  typeName: "count-step",
                  input: { n: job.input.n + 1, total: job.input.total },
                },
              });
            }),
          ),
      },

      signal: {
        attemptHandler: async ({ finish }) =>
          withTransactionHooks(async (transactionHooks) =>
            stateAdapter.withTransaction(async (ctx) =>
              finish({ ...ctx, transactionHooks, output: { fired: true } }),
            ),
          ),
      },

      "blocked-task": {
        attemptHandler: async ({ job, finish }) =>
          withTransactionHooks(async (transactionHooks) =>
            stateAdapter.withTransaction(async (ctx) =>
              finish({ ...ctx, transactionHooks, output: { index: job.input.index, done: true } }),
            ),
          ),
      },
    },
  }),
});

await stateAdapter.truncate();

const stopWorker = await worker.start();

console.log("\n=== Dashboard Job Populator ===\n");

// Scenario 1: Single Job
console.log("--- Scenario 1: Single Job ---");
const greetChain = await withTransactionHooks(async (transactionHooks) =>
  stateAdapter.withTransaction(async (ctx) =>
    client.createChain({ ...ctx, transactionHooks, typeName: "greet", input: { name: "World" } }),
  ),
);
await client.awaitChain(greetChain, { timeoutMs: 5000 });

// Scenario 2: Continuations
console.log("\n--- Scenario 2: Continuations ---");
const orderChain = await withTransactionHooks(async (transactionHooks) =>
  stateAdapter.withTransaction(async (ctx) =>
    client.createChain({
      ...ctx,
      transactionHooks,
      typeName: "order:validate",
      input: { orderId: "ORD-123" },
    }),
  ),
);
await client.awaitChain(orderChain, { timeoutMs: 5000 });

// Scenario 3: Blockers (fan-out)
console.log("\n--- Scenario 3: Blockers ---");
const blockerChain = await withTransactionHooks(async (transactionHooks) =>
  stateAdapter.withTransaction(async (ctx) => {
    return client.createChain({
      ...ctx,
      transactionHooks,
      typeName: "process-with-blockers",
      input: { taskId: "TASK-456" },
      blockers: await client.createChains({
        ...ctx,
        transactionHooks,
        items: [
          {
            typeName: "fetch-user",
            input: { userId: "user-1" },
          },
          {
            typeName: "fetch-permissions",
            input: { userId: "user-1" },
          },
        ],
      }),
    });
  }),
);
await client.awaitChain(blockerChain, { timeoutMs: 5000 });

// Scenario 4: Retries
console.log("\n--- Scenario 4: Retries ---");
const retryChain = await withTransactionHooks(async (transactionHooks) =>
  stateAdapter.withTransaction(async (ctx) =>
    client.createChain({
      ...ctx,
      transactionHooks,
      typeName: "might-fail",
      input: { shouldFail: true },
    }),
  ),
);
await client.awaitChain(retryChain, { timeoutMs: 5000 });

// Scenario 5: Scheduled Job (1 hour in the future — trigger it from the dashboard)
console.log("\n--- Scenario 5: Scheduled Job ---");
await withTransactionHooks(async (transactionHooks) =>
  stateAdapter.withTransaction(async (ctx) =>
    client.createChain({
      ...ctx,
      transactionHooks,
      typeName: "scheduled-report",
      input: { reportType: "daily-summary" },
      schedule: { afterMs: 60 * 60 * 1000 },
    }),
  ),
);

// Scenario 6: Long chain — one chain with many jobs (chain-detail job pagination)
console.log("\n--- Scenario 6: Long chain ---");
const longChain = await withTransactionHooks(async (transactionHooks) =>
  stateAdapter.withTransaction(async (ctx) =>
    client.createChain({
      ...ctx,
      transactionHooks,
      typeName: "count-step",
      input: { n: 1, total: DASHBOARD_PAGE_SIZE * 2 + 1 },
    }),
  ),
);
await client.awaitChain(longChain, { timeoutMs: 5000 });

// Scenario 7: Blocker fan-in — one pending chain blocking many jobs (chain-detail "Blocking" pagination)
console.log("\n--- Scenario 7: Blocker fan-in ---");
const hub = await withTransactionHooks(async (transactionHooks) =>
  stateAdapter.withTransaction(async (ctx) =>
    client.createChain({
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
    client.createChains({
      ...ctx,
      transactionHooks,
      items: Array.from({ length: DASHBOARD_PAGE_SIZE * 2 + 1 }, (_, index) => ({
        typeName: "blocked-task",
        input: { index },
        blockers: [hub],
      })),
    }),
  ),
);

await stopWorker();

// Scenario 8: Bulk volume — many root chains/jobs (chain-list + job-list pagination)
console.log("\n--- Scenario 8: Bulk volume ---");
await withTransactionHooks(async (transactionHooks) =>
  stateAdapter.withTransaction(async (ctx) =>
    client.createChains({
      ...ctx,
      transactionHooks,
      items: Array.from({ length: DASHBOARD_PAGE_SIZE * 2 + 1 }, (_, index) => ({
        typeName: "greet",
        input: { name: `User ${index + 1}` },
      })),
    }),
  ),
);

await notifyAdapter.close();
await stateAdapter.close();
db.close();

console.log("\nDone!");
