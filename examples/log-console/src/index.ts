import { createClient, createConsoleLog, createInProcessWorker, defineJobTypes } from "queuert";
import { createInProcessNotifyAdapter, createInProcessStateAdapter } from "queuert/internal";

// 1. Define job types
const registry = defineJobTypes<{
  greet: {
    entry: true;
    input: { name: string };
    output: { greeting: string };
  };
  "might-fail": {
    entry: true;
    input: { shouldFail: boolean };
    output: { success: true };
  };
}>();

// 2. Create adapters with console logging
const stateAdapter = createInProcessStateAdapter();
const notifyAdapter = createInProcessNotifyAdapter();
const log = createConsoleLog();

const qrtClient = await createClient({
  stateAdapter,
  notifyAdapter,
  log,
  registry,
});

// 3. Create and start worker
const qrtWorker = await createInProcessWorker({
  stateAdapter,
  notifyAdapter,
  log,
  registry,
  workerId: "worker-1",
  processors: {
    greet: {
      attemptHandler: async ({ job, complete }) => {
        console.log(`[app] Processing greeting for ${job.input.name}`);

        return complete(async () => ({
          greeting: `Hello, ${job.input.name}!`,
        }));
      },
    },
    "might-fail": {
      attemptHandler: async ({ job, complete }) => {
        console.log("[app] Processing might-fail job");

        if (job.input.shouldFail && job.attempt < 2) {
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
console.log(`\n[app] Successful job output: ${JSON.stringify(successCompleted.output)}`);

// 5. Run job that fails then succeeds (demonstrates error logging)
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
console.log(`\n[app] Retry job output: ${JSON.stringify(retryCompleted.output)}`);

// 6. Cleanup
await stopWorker();
