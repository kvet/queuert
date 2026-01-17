import { createQueuert, createConsoleLog, defineJobTypes } from "queuert";
import { createInProcessNotifyAdapter, createInProcessStateAdapter } from "queuert/internal";
import { observabilityAdapter, flushMetrics, shutdownMetrics } from "./observability.js";

// 1. Define job types
const jobTypeRegistry = defineJobTypes<{
  greet: { entry: true; input: { name: string }; output: { greeting: string } };
  "might-fail": { entry: true; input: { shouldFail: boolean }; output: { success: true } };
}>();

// 2. Create adapters and queuert with OTEL observability
const stateAdapter = createInProcessStateAdapter();
const qrt = await createQueuert({
  stateAdapter,
  notifyAdapter: createInProcessNotifyAdapter(),
  log: createConsoleLog(),
  observabilityAdapter,
  jobTypeRegistry,
});

// 3. Create and start worker
const worker = qrt
  .createWorker()
  .implementJobType({
    typeName: "greet",
    process: async ({ job, complete }) => {
      return complete(async () => ({
        greeting: `Hello, ${job.input.name}!`,
      }));
    },
  })
  .implementJobType({
    typeName: "might-fail",
    process: async ({ job, complete }) => {
      if (job.input.shouldFail && job.attempt < 2) {
        // Throw an error on first attempt to demonstrate metrics
        throw new Error("Simulated failure for demonstration");
      }
      return complete(async () => ({ success: true as const }));
    },
    retryConfig: { initialDelayMs: 100, maxDelayMs: 100 },
  });

const stopWorker = await worker.start({ workerId: "worker-1" });

// 4. Run successful job
console.log("\n--- Running successful job ---\n");
const successJob = await qrt.withNotify(async () =>
  stateAdapter.provideContext(async (ctx) =>
    stateAdapter.runInTransaction(ctx, async (ctx) =>
      qrt.startJobSequence({
        ...ctx,
        typeName: "greet",
        input: { name: "World" },
      }),
    ),
  ),
);

const successCompleted = await qrt.waitForJobSequenceCompletion(successJob, {
  timeoutMs: 5000,
});
console.log("Successful job completed:", successCompleted.output);

// 5. Run job that fails then succeeds (demonstrates attempt_failed metric)
console.log("\n--- Running job that fails first attempt ---\n");
const failThenSucceedJob = await qrt.withNotify(async () =>
  stateAdapter.provideContext(async (ctx) =>
    stateAdapter.runInTransaction(ctx, async (ctx) =>
      qrt.startJobSequence({
        ...ctx,
        typeName: "might-fail",
        input: { shouldFail: true },
      }),
    ),
  ),
);

const retryCompleted = await qrt.waitForJobSequenceCompletion(failThenSucceedJob, {
  timeoutMs: 5000,
});
console.log("Retry job completed after failure:", retryCompleted.output);

// 6. Stop worker and flush metrics
await stopWorker();

// 7. Flush and display collected metrics
console.log("\n--- OTEL Metrics Export ---\n");
await flushMetrics();

// 8. Cleanup
await shutdownMetrics();
console.log("\n--- Done ---\n");
