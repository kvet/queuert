/**
 * Runtime Validation with Zod Example
 *
 * This example demonstrates how to use Zod for runtime validation of job types.
 * It shows:
 * 1. Creating a Zod-based job type jobTypes
 * 2. Nominal reference validation (by type name)
 * 3. Structural reference validation (by input shape)
 */

import { createAsyncRwLock, createSqliteStateAdapter } from "@queuert/sqlite";
import Database from "better-sqlite3";
import { createBetterSqlite3StateProvider } from "example-state-sqlite-better-sqlite3/provider";
import { createClient, createWorkerRunner, createProcessors } from "queuert";
import { z } from "zod";

import { createZodJobTypes } from "./zod-adapter.ts";

// #region usage
// Define job types with Zod schemas
const jobTypes = createZodJobTypes({
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
      data: z.object({
        items: z.array(z.number()),
        source: z.string(),
      }),
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
// #endregion

// #region in-process-adapters
await using drivers = new AsyncDisposableStack();
const db = drivers.adopt(new Database(":memory:"), (db) => {
  db.close();
});
await using stateAdapter = createSqliteStateAdapter({
  stateProvider: createBetterSqlite3StateProvider({ db, lock: createAsyncRwLock() }),
});
await stateAdapter.migrateToLatest();
// #endregion

// Create queuert client with the jobTypes
const client = createClient({ stateAdapter, jobTypes });

// Create and start worker runner with job type processors
await using workerRunner = createWorkerRunner({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      "fetch-data": {
        attemptHandler: async ({ job, complete }) => {
          console.log(`Fetching data from ${job.input.url}`);
          const data = { items: [1, 2, 3], source: job.input.url };

          return stateAdapter.withTransaction(async (ctx) =>
            complete({
              ...ctx,
              continueWith: {
                typeName: "process-data",
                input: { data },
              },
            }),
          );
        },
      },
      "process-data": {
        attemptHandler: async ({ job, complete }) => {
          console.log("Processing data:", job.input.data);

          return stateAdapter.withTransaction(async (ctx) =>
            complete({
              ...ctx,
              output: {
                processed: true,
                itemCount: job.input.data.items.length,
              },
            }),
          );
        },
      },
      "batch-process": {
        attemptHandler: async ({ job, complete }) => {
          console.log(`Processing batch ${job.input.batchId}`);
          console.log("Blockers completed:", job.blockers.length);

          return stateAdapter.withTransaction(async (ctx) =>
            complete({ ...ctx, output: { success: true } }),
          );
        },
      },
      auth: {
        attemptHandler: async ({ job, complete }) => {
          console.log(`Authenticating with token: ${job.input.token.substring(0, 8)}...`);

          return stateAdapter.withTransaction(async (ctx) =>
            complete({
              ...ctx,
              output: {
                userId: `user-${job.input.token.substring(0, 4)}`,
              },
            }),
          );
        },
      },
    },
  }),
});

await workerRunner.start();

// Run a chain
console.log("\n=== Running fetch-data chain ===");
const chain = await stateAdapter.withTransaction(async (ctx) =>
  client.createChain({
    ...ctx,
    typeName: "fetch-data",
    input: { url: "https://api.example.com/data" },
  }),
);

const result = await client.awaitChain(chain, { timeoutMs: 5000 });
console.log("Chain completed:", result.output);

console.log("\n=== Done ===");
