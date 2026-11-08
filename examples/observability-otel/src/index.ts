/**
 * OpenTelemetry Observability Showcase
 *
 * Demonstrates tracing integration with OpenTelemetry for Queuert job-chain observability.
 *
 * Scenarios:
 * 1. Single Job: Basic chain with one job → one chain span, one job span, one attempt span
 * 2. Continuations: Linear chain of jobs → chain span contains multiple sequential job spans
 * 3. Blockers: Fan-out/fan-in pattern → chain span shows parallel blocker jobs with links
 * 4. Batched Work: Work in the handler's own transactions → still a single attempt span
 * 5. Retries: Job fails then succeeds → job span contains multiple attempt spans
 * 6. Workerless Completion: Job completed externally → CONSUMER job span without attempt spans
 */

import {
  createClient,
  createInProcessStateAdapter,
  createWorkerRunner,
  createProcessors,
  defineJobTypes,
  withTxHooks,
} from "queuert";

import { flush, observabilityAdapter, shutdown } from "./observability.ts";

const jobTypes = defineJobTypes<{
  /*
   * Scenario 1 - Single Job:
   *   greet → "Hello, {name}!"
   *
   * Trace structure:
   *   chain-span
   *     └─ job-span (greet)
   *          └─ attempt-span #1
   */
  greet: { entry: true; input: { name: string }; output: { greeting: string } };

  /*
   * Scenario 2 - Continuations:
   *   order:validate → order:process → order:complete
   *
   * Trace structure:
   *   chain-span
   *     ├─ job-span (order:validate)
   *     │    └─ attempt-span #1
   *     ├─ job-span (order:process)
   *     │    └─ attempt-span #1
   *     └─ job-span (order:complete)
   *          └─ attempt-span #1
   */
  "order:validate": {
    entry: true;
    input: { orderId: string };
    output: { orderId: string; validated: true };
    continueWith: { typeName: "order:process" };
  };
  "order:process": {
    input: { orderId: string; validated: true };
    output: { orderId: string; processed: true };
    continueWith: { typeName: "order:complete" };
  };
  "order:complete": {
    input: { orderId: string; processed: true };
    output: { orderId: string; status: "completed" };
  };

  /*
   * Scenario 3 - Blockers (fan-out):
   *   fetch-user ------+
   *                    +--> process-with-blockers
   *   fetch-permissions+
   *
   * Trace structure:
   *   chain-span (process-with-blockers)
   *     └─ job-span
   *          ├─ PRODUCER: await chain.fetch-user ──link──→ chain fetch-user
   *          │    └─ CONSUMER: complete chain.fetch-user
   *          ├─ PRODUCER: await chain.fetch-permissions ──link──→ chain fetch-permissions
   *          │    └─ CONSUMER: complete chain.fetch-permissions
   *          └─ attempt-span
   */
  "fetch-user": {
    entry: true;
    input: { userId: string };
    output: { userId: string; name: string };
  };
  "fetch-permissions": {
    entry: true;
    input: { userId: string };
    output: { userId: string; permissions: string[] };
  };
  "process-with-blockers": {
    entry: true;
    input: { taskId: string };
    output: { taskId: string; result: string };
    blockers: [{ typeName: "fetch-user" }, { typeName: "fetch-permissions" }];
  };

  /*
   * Scenario 4 - Batched work:
   *   batch-process → one transaction per batch, then complete in its own transaction
   *
   * Trace structure (queuert adds no child spans for the handler's transactions):
   *   chain-span
   *     └─ job-span (batch-process)
   *          └─ attempt-span #1
   */
  "batch-process": {
    entry: true;
    input: { items: number[] };
    output: { total: number };
  };

  /*
   * Scenario 5 - Retries:
   *   might-fail (attempt #1: fail) → (attempt #2: success)
   *
   * Trace structure:
   *   chain-span
   *     └─ job-span (might-fail)
   *          ├─ attempt-span #1 [ERROR]
   *          └─ attempt-span #2 [OK]
   */
  "might-fail": { entry: true; input: { shouldFail: boolean }; output: { success: true } };

  /*
   * Scenario 6 - Workerless Completion:
   *   awaiting-approval → completed externally via completeChain
   *
   * Trace structure:
   *   chain-span PRODUCER
   *     └─ job-span PRODUCER (awaiting-approval)
   *          └─ job-span CONSUMER (awaiting-approval)
   *               └─ chain-span CONSUMER
   */
  "awaiting-approval": {
    entry: true;
    input: { requestId: string };
    output: { approved: boolean; approvedBy: string };
  };
}>();

// Create adapters
const stateAdapter = createInProcessStateAdapter();

// #region client
const client = createClient({
  stateAdapter,
  observabilityAdapter,
  jobTypes,
});
// #endregion

// Create worker runner with processors
const workerRunner = createWorkerRunner({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      // Scenario 1: Simple job
      greet: {
        attemptHandler: async ({ job, complete }) => {
          await new Promise((r) => setTimeout(r, 20));
          return withTxHooks(async (txHooks) =>
            stateAdapter.withTransaction(async (ctx) =>
              complete({
                ...ctx,
                txHooks,
                output: {
                  greeting: `Hello, ${job.input.name}!`,
                },
              }),
            ),
          );
        },
      },

      // Scenario 2: Continuation jobs
      "order:validate": {
        attemptHandler: async ({ job, complete }) => {
          await new Promise((r) => setTimeout(r, 50));
          return withTxHooks(async (txHooks) =>
            stateAdapter.withTransaction(async (ctx) =>
              complete({
                ...ctx,
                txHooks,
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
        attemptHandler: async ({ job, complete }) => {
          await new Promise((r) => setTimeout(r, 100));
          return withTxHooks(async (txHooks) =>
            stateAdapter.withTransaction(async (ctx) =>
              complete({
                ...ctx,
                txHooks,
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
        attemptHandler: async ({ job, complete }) => {
          await new Promise((r) => setTimeout(r, 30));
          return withTxHooks(async (txHooks) =>
            stateAdapter.withTransaction(async (ctx) =>
              complete({
                ...ctx,
                txHooks,
                output: {
                  orderId: job.input.orderId,
                  status: "completed",
                },
              }),
            ),
          );
        },
      },

      // Scenario 3: Blocker jobs
      "fetch-user": {
        attemptHandler: async ({ job, complete }) => {
          await new Promise((r) => setTimeout(r, 80));
          return withTxHooks(async (txHooks) =>
            stateAdapter.withTransaction(async (ctx) =>
              complete({
                ...ctx,
                txHooks,
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
        attemptHandler: async ({ job, complete }) => {
          await new Promise((r) => setTimeout(r, 60));
          return withTxHooks(async (txHooks) =>
            stateAdapter.withTransaction(async (ctx) =>
              complete({
                ...ctx,
                txHooks,
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
        attemptHandler: async ({ job, complete }) => {
          const [userBlocker, permBlocker] = job.blockers;
          await new Promise((r) => setTimeout(r, 40));
          return withTxHooks(async (txHooks) =>
            stateAdapter.withTransaction(async (ctx) =>
              complete({
                ...ctx,
                txHooks,
                output: {
                  taskId: job.input.taskId,
                  result: `${userBlocker.output.name} has ${permBlocker.output.permissions.join(", ")}`,
                },
              }),
            ),
          );
        },
      },

      // Scenario 4: Batched work
      "batch-process": {
        attemptHandler: async ({ job, complete }) => {
          let total = 0;
          for (const item of job.input.items) {
            total += await stateAdapter.withTransaction(async () => {
              await new Promise((r) => setTimeout(r, 30));
              return item * 2;
            });
          }
          return withTxHooks(async (txHooks) =>
            stateAdapter.withTransaction(async (ctx) =>
              complete({ ...ctx, txHooks, output: { total } }),
            ),
          );
        },
      },

      // Scenario 5: Failing job
      "might-fail": {
        attemptHandler: async ({ job, complete }) => {
          if (job.input.shouldFail && job.attempt < 2) {
            throw new Error("Simulated failure");
          }
          return withTxHooks(async (txHooks) =>
            stateAdapter.withTransaction(async (ctx) =>
              complete({ ...ctx, txHooks, output: { success: true as const } }),
            ),
          );
        },
        backoffConfig: { initialDelayMs: 100, maxDelayMs: 100 },
      },
    },
  }),
});

const stopWorkerRunner = await workerRunner.start();

// Run all scenarios
console.log("\n=== OpenTelemetry Observability Showcase ===\n");
console.log("Optional: Run `pnpm tui` in another terminal to view traces\n");

// Scenario 1: Single Job
console.log("--- Scenario 1: Single Job ---");
console.log("One chain, one job, one attempt. Simplest trace structure.\n");
const greetChain = await withTxHooks(async (txHooks) =>
  stateAdapter.withTransaction(async (ctx) =>
    client.createChain({ ...ctx, txHooks, typeName: "greet", input: { name: "World" } }),
  ),
);
const greetResult = await client.awaitChain(greetChain, { timeoutMs: 5000 });
console.log("Result:", greetResult.output);

// Scenario 2: Continuations
console.log("\n--- Scenario 2: Continuations ---");
console.log("validate → process → complete. Chain span contains 3 sequential job spans.\n");
const orderChain = await withTxHooks(async (txHooks) =>
  stateAdapter.withTransaction(async (ctx) =>
    client.createChain({
      ...ctx,
      txHooks,
      typeName: "order:validate",
      input: { orderId: "ORD-123" },
    }),
  ),
);
const orderResult = await client.awaitChain(orderChain, { timeoutMs: 10000 });
console.log("Result:", orderResult.output);

// Scenario 3: Blockers (fan-out)
console.log("\n--- Scenario 3: Blockers ---");
console.log("Two blockers run in parallel, main job waits. Traces linked across chains.\n");
const blockerChain = await withTxHooks(async (txHooks) =>
  stateAdapter.withTransaction(async (ctx) => {
    const userBlocker = await client.createChain({
      ...ctx,
      txHooks,
      typeName: "fetch-user",
      input: { userId: "user-1" },
    });
    const permBlocker = await client.createChain({
      ...ctx,
      txHooks,
      typeName: "fetch-permissions",
      input: { userId: "user-1" },
    });
    return client.createChain({
      ...ctx,
      txHooks,
      typeName: "process-with-blockers",
      input: { taskId: "TASK-456" },
      blockers: [userBlocker, permBlocker],
    });
  }),
);
const blockerResult = await client.awaitChain(blockerChain, { timeoutMs: 10000 });
console.log("Result:", blockerResult.output);

// Scenario 4: Batched work
console.log("\n--- Scenario 4: Batched Work ---");
console.log(
  "Handler runs one transaction per batch, then finishes in its own. One attempt span, no child spans.\n",
);
const batchChain = await withTxHooks(async (txHooks) =>
  stateAdapter.withTransaction(async (ctx) =>
    client.createChain({
      ...ctx,
      txHooks,
      typeName: "batch-process",
      input: { items: [10, 20] },
    }),
  ),
);
const batchResult = await client.awaitChain(batchChain, { timeoutMs: 5000 });
console.log("Result:", batchResult.output);

// Scenario 5: Retries
console.log("\n--- Scenario 5: Retries ---");
console.log("First attempt fails, second succeeds. Job span shows multiple attempt spans.\n");
const retryChain = await withTxHooks(async (txHooks) =>
  stateAdapter.withTransaction(async (ctx) =>
    client.createChain({
      ...ctx,
      txHooks,
      typeName: "might-fail",
      input: { shouldFail: true },
    }),
  ),
);
const retryResult = await client.awaitChain(retryChain, { timeoutMs: 5000 });
console.log("Result:", retryResult.output);

// Scenario 6: Workerless Completion
console.log("\n--- Scenario 6: Workerless Completion ---");
console.log("Job completed externally without a worker. CONSUMER job span, no attempt spans.\n");
const approvalChain = await withTxHooks(async (txHooks) =>
  stateAdapter.withTransaction(async (ctx) =>
    client.createChain({
      ...ctx,
      txHooks,
      typeName: "awaiting-approval",
      input: { requestId: "REQ-789" },
    }),
  ),
);
const approvalResult = await withTxHooks(async (txHooks) =>
  stateAdapter.withTransaction(async (ctx) =>
    client.completeChain({
      ...ctx,
      txHooks,
      ...approvalChain,
      handler: async ({ job, completeJob }) =>
        completeJob(job, async ({ complete }) =>
          complete({ output: { approved: true, approvedBy: "admin" } }),
        ),
    }),
  ),
);
if (approvalResult.status === "completed") {
  console.log("Result:", approvalResult.output);
}

// Cleanup
await stopWorkerRunner();
await stateAdapter.close();
console.log("\nFlushing telemetry...");
await flush();
await shutdown();

console.log("\n" + "=".repeat(45));
console.log("All scenarios completed.");
console.log("=".repeat(45));
