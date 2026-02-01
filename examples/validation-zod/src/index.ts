/**
 * Runtime Validation with Zod Example
 *
 * This example demonstrates how to use Zod for runtime validation of job types.
 * It shows:
 * 1. Creating a Zod-based job type registry
 * 2. Nominal reference validation (by type name)
 * 3. Structural reference validation (by input shape)
 */

import { z } from "zod";
import { createQueuertClient, createQueuertInProcessWorker } from "queuert";
import { createInProcessNotifyAdapter, createInProcessStateAdapter } from "queuert/internal";
import { createZodJobTypeRegistry } from "./zod-adapter.js";

// 1. Define job types with Zod schemas
const registry = createZodJobTypeRegistry({
  // Entry point with nominal continuation validation
  "fetch-data": {
    entry: true,
    input: z.object({
      url: z.url(),
      headers: z.record(z.string(), z.string()).optional(),
    }),
    // Nominal validation: validates by type name
    continueWith: z.object({
      typeName: z.literal("process-data"),
    }),
  },

  // Continuation job
  "process-data": {
    input: z.object({
      data: z.unknown(),
    }),
    output: z.object({
      processed: z.boolean(),
      itemCount: z.number(),
    }),
  },

  // Entry point with structural blocker validation
  "batch-process": {
    entry: true,
    input: z.object({
      batchId: z.string(),
    }),
    output: z.object({
      success: z.boolean(),
    }),
    // Structural validation: any blocker with { token: string } input is valid
    blockers: z.array(
      z.object({
        input: z.object({ token: z.string() }),
      }),
    ),
  },

  // Auth job - can be used as blocker due to structural match
  auth: {
    entry: true,
    input: z.object({
      token: z.string(),
    }),
    output: z.object({
      userId: z.string(),
    }),
  },
});

// 2. Create queuert client and worker with the registry
const stateAdapter = createInProcessStateAdapter();
const notifyAdapter = createInProcessNotifyAdapter();

const qrtClient = await createQueuertClient({
  stateAdapter,
  notifyAdapter,
  registry,
});

// 3. Create and start qrtWorker with job type processors
const qrtWorker = await createQueuertInProcessWorker({
  stateAdapter,
  notifyAdapter,
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
