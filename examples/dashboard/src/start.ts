/**
 * Job Populator
 *
 * Creates job chains matching the 4 standard demo scenarios and processes them,
 * populating the shared SQLite database for the dashboard to display.
 *
 * Usage: pnpm start
 * Then open http://localhost:3333 to view results in the dashboard.
 */

import { createInProcessWorker } from "queuert";
import { client, db, notifyAdapter, registry, stateAdapter } from "./client.js";

const worker = await createInProcessWorker({
  stateAdapter,
  notifyAdapter,
  registry,
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
      retryConfig: { initialDelayMs: 100, maxDelayMs: 100 },
    },
  },
});

const stopWorker = await worker.start();

console.log("\n=== Dashboard Job Populator ===\n");

// Scenario 1: Single Job
console.log("--- Scenario 1: Single Job ---");
const greetJob = await client.withNotify(async () =>
  stateAdapter.runInTransaction(async (ctx) =>
    client.startJobChain({ ...ctx, typeName: "greet", input: { name: "World" } }),
  ),
);
const greetResult = await client.waitForJobChainCompletion(greetJob, { timeoutMs: 5000 });
console.log("Result:", greetResult.output);

// Scenario 2: Continuations
console.log("\n--- Scenario 2: Continuations ---");
const orderJob = await client.withNotify(async () =>
  stateAdapter.runInTransaction(async (ctx) =>
    client.startJobChain({ ...ctx, typeName: "order:validate", input: { orderId: "ORD-123" } }),
  ),
);
const orderResult = await client.waitForJobChainCompletion(orderJob, { timeoutMs: 10000 });
console.log("Result:", orderResult.output);

// Scenario 3: Blockers (fan-out/fan-in)
console.log("\n--- Scenario 3: Blockers ---");
const blockerJob = await client.withNotify(async () =>
  stateAdapter.runInTransaction(async (ctx) => {
    const userBlocker = await client.startJobChain({
      ...ctx,
      typeName: "fetch-user",
      input: { userId: "user-1" },
    });
    const permBlocker = await client.startJobChain({
      ...ctx,
      typeName: "fetch-permissions",
      input: { userId: "user-1" },
    });
    return client.startJobChain({
      ...ctx,
      typeName: "process-with-blockers",
      input: { taskId: "TASK-456" },
      blockers: [userBlocker, permBlocker],
    });
  }),
);
const blockerResult = await client.waitForJobChainCompletion(blockerJob, { timeoutMs: 10000 });
console.log("Result:", blockerResult.output);

// Scenario 4: Retries
console.log("\n--- Scenario 4: Retries ---");
const retryJob = await client.withNotify(async () =>
  stateAdapter.runInTransaction(async (ctx) =>
    client.startJobChain({ ...ctx, typeName: "might-fail", input: { shouldFail: true } }),
  ),
);
const retryResult = await client.waitForJobChainCompletion(retryJob, { timeoutMs: 5000 });
console.log("Result:", retryResult.output);

// Cleanup
await stopWorker();
db.close();

console.log("\nDone! Open http://localhost:3333 to view the dashboard.");

async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
