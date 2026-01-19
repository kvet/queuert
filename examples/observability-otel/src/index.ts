import {
  createQueuertClient,
  createQueuertInProcessWorker,
  createConsoleLog,
  defineJobTypes,
} from "queuert";
import { createInProcessNotifyAdapter, createInProcessStateAdapter } from "queuert/internal";
import { observabilityAdapter, flushMetrics, shutdownMetrics } from "./observability.js";

// 1. Define job types
const jobTypeRegistry = defineJobTypes<{
  greet: { entry: true; input: { name: string }; output: { greeting: string } };
  "might-fail": { entry: true; input: { shouldFail: boolean }; output: { success: true } };
}>();

// 2. Create adapters and queuert client/worker with OTEL observability
const stateAdapter = createInProcessStateAdapter();
const notifyAdapter = createInProcessNotifyAdapter();
const log = createConsoleLog();

const qrtClient = await createQueuertClient({
  stateAdapter,
  notifyAdapter,
  log,
  observabilityAdapter,
  jobTypeRegistry,
});
// 3. Create and start qrtWorker
const qrtWorker = await createQueuertInProcessWorker({
  stateAdapter,
  notifyAdapter,
  log,
  observabilityAdapter,
  jobTypeRegistry,
  workerId: "worker-1",
  jobTypeProcessors: {
    greet: {
      process: async ({ job, complete }) => {
        return complete(async () => ({
          greeting: `Hello, ${job.input.name}!`,
        }));
      },
    },
    "might-fail": {
      process: async ({ job, complete }) => {
        if (job.input.shouldFail && job.attempt < 2) {
          // Throw an error on first attempt to demonstrate metrics
          throw new Error("Simulated failure for demonstration");
        }
        return complete(async () => ({ success: true as const }));
      },
      retryConfig: { initialDelayMs: 100, maxDelayMs: 100 },
    },
  },
});

const stopWorker = await qrtWorker.start();

// 4. Run successful job
console.log("\n--- Running successful job ---\n");
const successJob = await qrtClient.withNotify(async () =>
  stateAdapter.runInTransaction(async (ctx) =>
    qrtClient.startJobChain({
      ...ctx,
      typeName: "greet",
      input: { name: "World" },
    }),
  ),
);

const successCompleted = await qrtClient.waitForJobChainCompletion(successJob, {
  timeoutMs: 5000,
});
console.log("Successful job completed:", successCompleted.output);

// 5. Run job that fails then succeeds (demonstrates attempt_failed metric)
console.log("\n--- Running job that fails first attempt ---\n");
const failThenSucceedJob = await qrtClient.withNotify(async () =>
  stateAdapter.runInTransaction(async (ctx) =>
    qrtClient.startJobChain({
      ...ctx,
      typeName: "might-fail",
      input: { shouldFail: true },
    }),
  ),
);

const retryCompleted = await qrtClient.waitForJobChainCompletion(failThenSucceedJob, {
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
