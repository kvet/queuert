/**
 * Runtime Validation with TypeBox Example
 *
 * This example demonstrates how to use TypeBox for runtime validation of job types.
 * It shows:
 * 1. Creating a TypeBox-based job type jobTypes
 * 2. Nominal reference validation (by type name)
 * 3. Structural reference validation (by input shape)
 */

import { Type } from "@sinclair/typebox";
import {
  createClient,
  createWorkerRunner,
  createProcessors,
  withTxHooks,
  createInProcessStateAdapter,
} from "queuert";

import { createTypeBoxJobTypes } from "./typebox-adapter.ts";

// #region usage
// URL format for TypeBox (simplified pattern)
const UrlString = Type.String({ pattern: "^https?://" });

// Define job types with TypeBox schemas
const jobTypes = createTypeBoxJobTypes({
  // Entry point with nominal continuation validation
  "fetch-data": {
    entry: true,
    input: Type.Object({
      url: UrlString,
      headers: Type.Optional(Type.Record(Type.String(), Type.String())),
    }),
    // Nominal validation: validates by type name
    continueWith: Type.Object({
      typeName: Type.Literal("process-data"),
    }),
  },

  // Continuation job
  "process-data": {
    input: Type.Object({
      data: Type.Unknown(),
    }),
    output: Type.Object({
      processed: Type.Boolean(),
      itemCount: Type.Number(),
    }),
  },

  // Entry point with structural blocker validation
  "batch-process": {
    entry: true,
    input: Type.Object({
      batchId: Type.String(),
    }),
    output: Type.Object({
      success: Type.Boolean(),
    }),
    // Structural validation: any blocker with { token: string } input is valid
    blockers: Type.Array(
      Type.Object({
        input: Type.Object({ token: Type.String() }),
      }),
    ),
  },

  // Auth job - can be used as blocker due to structural match
  auth: {
    entry: true,
    input: Type.Object({
      token: Type.String(),
    }),
    output: Type.Object({
      userId: Type.String(),
    }),
  },
});
// #endregion

// Create queuert client with the jobTypes
const stateAdapter = createInProcessStateAdapter();

const client = createClient({ stateAdapter, jobTypes });

// Create and start worker runner with job type processors
const workerRunner = createWorkerRunner({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      "fetch-data": {
        attemptHandler: async ({ job, complete }) => {
          console.log(`Fetching data from ${job.input.url}`);
          const data = { items: [1, 2, 3], source: job.input.url };

          return withTxHooks(async (txHooks) =>
            stateAdapter.withTransaction(async (ctx) =>
              complete({
                ...ctx,
                txHooks,
                continueWith: {
                  typeName: "process-data",
                  input: { data },
                },
              }),
            ),
          );
        },
      },
      "process-data": {
        attemptHandler: async ({ job, complete }) => {
          console.log("Processing data:", job.input.data);
          const data = job.input.data as { items: number[] };

          return withTxHooks(async (txHooks) =>
            stateAdapter.withTransaction(async (ctx) =>
              complete({
                ...ctx,
                txHooks,
                output: {
                  processed: true,
                  itemCount: data.items?.length ?? 0,
                },
              }),
            ),
          );
        },
      },
      "batch-process": {
        attemptHandler: async ({ job, complete }) => {
          console.log(`Processing batch ${job.input.batchId}`);
          console.log("Blockers completed:", job.blockers.length);

          return withTxHooks(async (txHooks) =>
            stateAdapter.withTransaction(async (ctx) =>
              complete({ ...ctx, txHooks, output: { success: true } }),
            ),
          );
        },
      },
      auth: {
        attemptHandler: async ({ job, complete }) => {
          console.log(`Authenticating with token: ${job.input.token.substring(0, 8)}...`);

          return withTxHooks(async (txHooks) =>
            stateAdapter.withTransaction(async (ctx) =>
              complete({
                ...ctx,
                txHooks,
                output: {
                  userId: `user-${job.input.token.substring(0, 4)}`,
                },
              }),
            ),
          );
        },
      },
    },
  }),
});

const stopWorkerRunner = await workerRunner.start();

// Run a chain
console.log("\n=== Running fetch-data chain ===");
const chain = await withTxHooks(async (txHooks) =>
  stateAdapter.withTransaction(async (ctx) =>
    client.createChain({
      ...ctx,
      txHooks,
      typeName: "fetch-data",
      input: { url: "https://api.example.com/data" },
    }),
  ),
);

const result = await client.awaitChain(chain, { timeoutMs: 5000 });
console.log("Chain completed:", result.output);

// Cleanup
await stopWorkerRunner();
await stateAdapter.close();
console.log("\n=== Done ===");
