/**
 * Runtime Validation with Valibot Example
 *
 * This example demonstrates how to use Valibot for runtime validation of job types.
 * It shows:
 * 1. Creating a Valibot-based job type registry
 * 2. Nominal reference validation (by type name)
 * 3. Structural reference validation (by input shape)
 */

import * as v from "valibot";
import { createClient, createInProcessWorker } from "queuert";
import { createInProcessNotifyAdapter, createInProcessStateAdapter } from "queuert/internal";
import { createValibotJobTypeRegistry } from "./valibot-adapter.js";

// 1. Define job types with Valibot schemas
const registry = createValibotJobTypeRegistry({
  // Entry point with nominal continuation validation
  "fetch-data": {
    entry: true,
    input: v.object({
      url: v.pipe(v.string(), v.url()),
      headers: v.optional(v.record(v.string(), v.string())),
    }),
    // Nominal validation: validates by type name
    continueWith: v.object({
      typeName: v.literal("process-data"),
    }),
  },

  // Continuation job
  "process-data": {
    input: v.object({
      data: v.unknown(),
    }),
    output: v.object({
      processed: v.boolean(),
      itemCount: v.number(),
    }),
  },

  // Entry point with structural blocker validation
  "batch-process": {
    entry: true,
    input: v.object({
      batchId: v.string(),
    }),
    output: v.object({
      success: v.boolean(),
    }),
    // Structural validation: any blocker with { token: string } input is valid
    blockers: v.array(
      v.object({
        input: v.object({ token: v.string() }),
      }),
    ),
  },

  // Auth job - can be used as blocker due to structural match
  auth: {
    entry: true,
    input: v.object({
      token: v.string(),
    }),
    output: v.object({
      userId: v.string(),
    }),
  },
});

// 2. Create queuert client and worker with the registry
const stateAdapter = createInProcessStateAdapter();
const notifyAdapter = createInProcessNotifyAdapter();

const qrtClient = await createClient({
  stateAdapter,
  notifyAdapter,
  registry,
});

// 3. Create and start qrtWorker with job type processors
const qrtWorker = await createInProcessWorker({
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
