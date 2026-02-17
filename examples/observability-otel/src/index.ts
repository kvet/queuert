/**
 * OpenTelemetry Observability Showcase
 *
 * Demonstrates tracing integration with OpenTelemetry for job queue observability.
 *
 * Scenarios:
 * 1. Single Job: Basic chain with one job → one chain span, one job span, one attempt span
 * 2. Continuations: Linear chain of jobs → chain span contains multiple sequential job spans
 * 3. Blockers: Fan-out/fan-in pattern → chain span shows parallel blocker jobs with links
 * 4. Retries: Job fails then succeeds → job span contains multiple attempt spans
 * 5. Workerless Completion: Job completed externally → CONSUMER job span without attempt spans
 */

import { createClient, createInProcessWorker, defineJobTypes } from "queuert";
import { createInProcessNotifyAdapter, createInProcessStateAdapter } from "queuert/internal";
import { flush, observabilityAdapter, shutdown } from "./observability.js";

const registry = defineJobTypes<{
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
   * Scenario 3 - Blockers (fan-out/fan-in):
   *   fetch-user ------+
   *                    +--> process-with-blockers
   *   fetch-permissions+
   *
   * Trace structure:
   *   chain-span (process-with-blockers)
   *     └─ job-span
   *          ├─ PRODUCER: await chain.fetch-user ──link──→ chain fetch-user
   *          │    └─ CONSUMER: resolve chain.fetch-user
   *          ├─ PRODUCER: await chain.fetch-permissions ──link──→ chain fetch-permissions
   *          │    └─ CONSUMER: resolve chain.fetch-permissions
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
   * Scenario 4 - Retries:
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
   * Scenario 5 - Workerless Completion:
   *   awaiting-approval → completed externally via completeJobChain
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
const notifyAdapter = createInProcessNotifyAdapter();

const client = await createClient({
  stateAdapter,
  notifyAdapter,
  observabilityAdapter,
  registry,
});

// Create worker with processors
const worker = await createInProcessWorker({
  stateAdapter,
  notifyAdapter,
  observabilityAdapter,
  registry,
  workerId: "worker-1",
  processors: {
    // Scenario 1: Simple job
    greet: {
      attemptHandler: async ({ job, complete }) => {
        await new Promise((r) => setTimeout(r, 20));
        return complete(async () => ({
          greeting: `Hello, ${job.input.name}!`,
        }));
      },
    },

    // Scenario 2: Continuation jobs
    "order:validate": {
      attemptHandler: async ({ job, complete }) => {
        await new Promise((r) => setTimeout(r, 50));
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
        await new Promise((r) => setTimeout(r, 100));
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
        await new Promise((r) => setTimeout(r, 30));
        return complete(async () => ({
          orderId: job.input.orderId,
          status: "completed",
        }));
      },
    },

    // Scenario 3: Blocker jobs
    "fetch-user": {
      attemptHandler: async ({ job, complete }) => {
        await new Promise((r) => setTimeout(r, 80));
        return complete(async () => ({
          userId: job.input.userId,
          name: "Alice",
        }));
      },
    },
    "fetch-permissions": {
      attemptHandler: async ({ job, complete }) => {
        await new Promise((r) => setTimeout(r, 60));
        return complete(async () => ({
          userId: job.input.userId,
          permissions: ["read", "write"],
        }));
      },
    },
    "process-with-blockers": {
      attemptHandler: async ({ job, complete }) => {
        const [userBlocker, permBlocker] = job.blockers;
        await new Promise((r) => setTimeout(r, 40));
        return complete(async () => ({
          taskId: job.input.taskId,
          result: `${userBlocker.output.name} has ${permBlocker.output.permissions.join(", ")}`,
        }));
      },
    },

    // Scenario 4: Failing job
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

// Run all scenarios
console.log("\n=== OpenTelemetry Observability Showcase ===\n");
console.log("Optional: Run `pnpm tui` in another terminal to view traces\n");

// Scenario 1: Single Job
console.log("--- Scenario 1: Single Job ---");
console.log("One chain, one job, one attempt. Simplest trace structure.\n");
const greetJob = await client.withNotify(async () =>
  stateAdapter.runInTransaction(async (ctx) =>
    client.startJobChain({ ...ctx, typeName: "greet", input: { name: "World" } }),
  ),
);
const greetResult = await client.waitForJobChainCompletion(greetJob, { timeoutMs: 5000 });
console.log("Result:", greetResult.output);

// Scenario 2: Continuations
console.log("\n--- Scenario 2: Continuations ---");
console.log("validate → process → complete. Chain span contains 3 sequential job spans.\n");
const orderJob = await client.withNotify(async () =>
  stateAdapter.runInTransaction(async (ctx) =>
    client.startJobChain({ ...ctx, typeName: "order:validate", input: { orderId: "ORD-123" } }),
  ),
);
const orderResult = await client.waitForJobChainCompletion(orderJob, { timeoutMs: 10000 });
console.log("Result:", orderResult.output);

// Scenario 3: Blockers (fan-out/fan-in)
console.log("\n--- Scenario 3: Blockers ---");
console.log("Two blockers run in parallel, main job waits. Traces linked across chains.\n");
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
console.log("First attempt fails, second succeeds. Job span shows multiple attempt spans.\n");
const retryJob = await client.withNotify(async () =>
  stateAdapter.runInTransaction(async (ctx) =>
    client.startJobChain({ ...ctx, typeName: "might-fail", input: { shouldFail: true } }),
  ),
);
const retryResult = await client.waitForJobChainCompletion(retryJob, { timeoutMs: 5000 });
console.log("Result:", retryResult.output);

// Scenario 5: Workerless Completion
console.log("\n--- Scenario 5: Workerless Completion ---");
console.log("Job completed externally without a worker. CONSUMER job span, no attempt spans.\n");
const approvalJob = await client.withNotify(async () =>
  stateAdapter.runInTransaction(async (ctx) =>
    client.startJobChain({
      ...ctx,
      typeName: "awaiting-approval",
      input: { requestId: "REQ-789" },
    }),
  ),
);
const approvalResult = await client.withNotify(async () =>
  stateAdapter.runInTransaction(async (ctx) =>
    client.completeJobChain({
      ...ctx,
      typeName: "awaiting-approval",
      id: approvalJob.id,
      complete: async ({ job, complete }) =>
        complete(job, async () => ({
          approved: true,
          approvedBy: "admin",
        })),
    }),
  ),
);
console.log("Result:", approvalResult.output);

// Cleanup
await stopWorker();
console.log("\nFlushing telemetry...");
await flush();
await shutdown();

console.log("\n" + "=".repeat(45));
console.log("All scenarios completed.");
console.log("=".repeat(45));
