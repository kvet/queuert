import {
  createClient,
  createConsoleLog,
  createInProcessNotifyAdapter,
  createInProcessStateAdapter,
  createWorkerRunner,
  createProcessors,
  defineJobTypes,
  withTxHooks,
} from "queuert";

// Define job types
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

// Create adapters with console logging
const stateAdapter = createInProcessStateAdapter();
const notifyAdapter = createInProcessNotifyAdapter();
// #region client
const log = createConsoleLog();

const client = createClient({
  stateAdapter,
  notifyAdapter,
  log,
  jobTypes,
});
// #endregion

// Create and start worker runner
const workerRunner = createWorkerRunner({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      greet: {
        attemptHandler: async ({ job, complete }) => {
          console.log(`[app] Processing greeting for ${job.input.name}`);

          return withTxHooks(async (txHooks) =>
            stateAdapter.withTransaction(async (ctx) =>
              complete({
                ...ctx,
                txHooks,
                output: { greeting: `Hello, ${job.input.name}!` },
              }),
            ),
          );
        },
      },
      "might-fail": {
        attemptHandler: async ({ job, complete }) => {
          console.log("[app] Processing might-fail job");

          if (job.input.shouldFail && job.attempt < 2) {
            throw new Error("Simulated failure for demonstration");
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

// Run successful job
console.log("\n--- Running successful job ---\n");
const successChain = await withTxHooks(async (txHooks) =>
  stateAdapter.withTransaction(async (ctx) =>
    client.createChain({
      ...ctx,
      txHooks,
      typeName: "greet",
      input: { name: "World" },
    }),
  ),
);
await client.awaitChain(successChain, { timeoutMs: 5000 });

// Run job that fails then succeeds (demonstrates error logging)
console.log("\n--- Running job that fails first attempt ---\n");
const failThenSucceedChain = await withTxHooks(async (txHooks) =>
  stateAdapter.withTransaction(async (ctx) =>
    client.createChain({
      ...ctx,
      txHooks,
      typeName: "might-fail",
      input: { shouldFail: true },
    }),
  ),
);
await client.awaitChain(failThenSucceedChain, { timeoutMs: 5000 });

// Cleanup
await stopWorkerRunner();
await notifyAdapter.close();
await stateAdapter.close();
