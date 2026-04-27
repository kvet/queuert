import {
  createClient,
  createConsoleLog,
  createInProcessWorker,
  createProcessors,
  defineJobTypes,
  withTransactionHooks,
  createInProcessNotifyAdapter,
  createInProcessStateAdapter,
} from "queuert";

// 1. Define job types
const jobTypes = defineJobTypes<{
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
const stateAdapter = await createInProcessStateAdapter();
const notifyAdapter = await createInProcessNotifyAdapter();
const log = createConsoleLog();

const client = await createClient({
  stateAdapter,
  notifyAdapter,
  log,
  jobTypes,
});

// 3. Create and start worker
const worker = await createInProcessWorker({
  client,
  workerId: "worker-1",
  processors: createProcessors({
    client,
    jobTypes,
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
        backoffConfig: { initialDelayMs: 100, maxDelayMs: 100 },
      },
    },
  }),
});

const stopWorker = await worker.start();

// 4. Run successful job
console.log("\n--- Running successful job ---\n");
const successJob = await withTransactionHooks(async (transactionHooks) =>
  stateAdapter.withTransaction(async (ctx) =>
    client.startJobChain({
      ...ctx,
      transactionHooks,
      typeName: "greet",
      input: { name: "World" },
    }),
  ),
);

const successCompleted = await client.awaitJobChain(successJob, {
  timeoutMs: 5000,
});
console.log(`\n[app] Successful job output: ${JSON.stringify(successCompleted.output)}`);

// 5. Run job that fails then succeeds (demonstrates error logging)
console.log("\n--- Running job that fails first attempt ---\n");
const failThenSucceedJob = await withTransactionHooks(async (transactionHooks) =>
  stateAdapter.withTransaction(async (ctx) =>
    client.startJobChain({
      ...ctx,
      transactionHooks,
      typeName: "might-fail",
      input: { shouldFail: true },
    }),
  ),
);

const retryCompleted = await client.awaitJobChain(failThenSucceedJob, {
  timeoutMs: 5000,
});
console.log(`\n[app] Retry job output: ${JSON.stringify(retryCompleted.output)}`);

// 6. Cleanup
await stopWorker();
await notifyAdapter.close();
await stateAdapter.close();
