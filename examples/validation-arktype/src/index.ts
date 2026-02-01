/**
 * Runtime Validation with ArkType Example
 *
 * This example demonstrates how to use ArkType for runtime validation of job types.
 * It shows:
 * 1. Creating an ArkType-based job type registry
 * 2. Nominal reference validation (by type name)
 * 3. Structural reference validation (by input shape)
 */

import { type } from "arktype";
import { createConsoleLog, createQueuertClient, createQueuertInProcessWorker } from "queuert";
import { createInProcessNotifyAdapter, createInProcessStateAdapter } from "queuert/internal";
import { createArkTypeJobTypeRegistry } from "./arktype-adapter.js";

// 1. Define job types with ArkType schemas
const registry = createArkTypeJobTypeRegistry({
  // Entry point with nominal continuation validation
  "fetch-data": {
    entry: true,
    input: type({
      url: "string.url",
      "headers?": "Record<string, string>",
    }),
    // Nominal validation: validates by type name
    continueWith: type({
      typeName: "'process-data'",
    }),
  },

  // Continuation job
  "process-data": {
    input: type({
      data: "unknown",
    }),
    output: type({
      processed: "boolean",
      itemCount: "number",
    }),
  },

  // Entry point with structural blocker validation
  "batch-process": {
    entry: true,
    input: type({
      batchId: "string",
    }),
    output: type({
      success: "boolean",
    }),
    // Structural validation: any blocker with { token: string } input is valid
    blockers: type({
      input: { token: "string" },
    }).array(),
  },

  // Auth job - can be used as blocker due to structural match
  auth: {
    entry: true,
    input: type({
      token: "string",
    }),
    output: type({
      userId: "string",
    }),
  },
});

// 2. Create queuert client and worker with the registry
const stateAdapter = createInProcessStateAdapter();
const notifyAdapter = createInProcessNotifyAdapter();
const log = createConsoleLog();

const qrtClient = await createQueuertClient({
  stateAdapter,
  notifyAdapter,
  log,
  registry,
});

// 3. Create and start qrtWorker with job type processors
const qrtWorker = await createQueuertInProcessWorker({
  stateAdapter,
  notifyAdapter,
  log,
  registry,
  processors: {
    "fetch-data": {
      attemptHandler: async ({ job, complete }) => {
        console.log(`Fetching data from ${job.input.url}`);
        const data = { items: [1, 2, 3], source: job.input.url };

        return complete(async ({ continueWith }) =>
          continueWith({
            typeName: "process-data",
            input: { data },
          }),
        );
      },
    },
    "process-data": {
      attemptHandler: async ({ job, complete }) => {
        console.log("Processing data:", job.input.data);
        const data = job.input.data as { items: number[] };

        return complete(async () => ({
          processed: true,
          itemCount: data.items?.length ?? 0,
        }));
      },
    },
    "batch-process": {
      attemptHandler: async ({ job, complete }) => {
        console.log(`Processing batch ${job.input.batchId}`);
        console.log("Blockers completed:", job.blockers.length);

        return complete(async () => ({
          success: true,
        }));
      },
    },
    auth: {
      attemptHandler: async ({ job, complete }) => {
        console.log(`Authenticating with token: ${job.input.token.substring(0, 8)}...`);
        return complete(async () => ({
          userId: `user-${job.input.token.substring(0, 4)}`,
        }));
      },
    },
  },
});

const stopWorker = await qrtWorker.start();

// 4. Run a chain
console.log("\n=== Running fetch-data chain ===");
const chain = await qrtClient.withNotify(async () =>
  stateAdapter.runInTransaction(async (ctx) =>
    qrtClient.startJobChain({
      ...ctx,
      typeName: "fetch-data",
      input: { url: "https://api.example.com/data" },
    }),
  ),
);

const result = await qrtClient.waitForJobChainCompletion(chain, { timeoutMs: 5000 });
console.log("Chain completed:", result.output);

// 5. Cleanup
await stopWorker();
console.log("\n=== Done ===");
