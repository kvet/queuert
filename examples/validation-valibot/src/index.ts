/**
 * Runtime Validation with Valibot Example
 *
 * This example demonstrates how to use Valibot for runtime validation of job types.
 * It shows:
 * 1. Creating a Valibot-based job type jobTypes
 * 2. Nominal reference validation (by type name)
 * 3. Structural reference validation (by input shape)
 */

import { createSqliteStateAdapter } from "@queuert/sqlite";
import Database from "better-sqlite3";
import { createBetterSqlite3StateProvider } from "example-state-sqlite-better-sqlite3/provider";
import { createClient, createWorkerRunner, createProcessors } from "queuert";
import * as v from "valibot";

import { createValibotJobTypes } from "./valibot-adapter.ts";

// #region usage
// Define job types with Valibot schemas
const jobTypes = createValibotJobTypes({
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
// #endregion

// Create queuert client with the jobTypes
using drivers = new DisposableStack();
const db = drivers.adopt(new Database(":memory:"), (db) => {
  db.close();
});
using stateAdapter = createSqliteStateAdapter({
  stateProvider: createBetterSqlite3StateProvider({ db }),
});
stateAdapter.migrateToLatest();

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

          return stateAdapter.withTransaction((ctx) =>
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
          const data = job.input.data as { items: number[] };

          return stateAdapter.withTransaction((ctx) =>
            complete({
              ...ctx,
              output: {
                processed: true,
                itemCount: data.items?.length ?? 0,
              },
            }),
          );
        },
      },
      "batch-process": {
        attemptHandler: async ({ job, complete }) => {
          console.log(`Processing batch ${job.input.batchId}`);
          console.log("Blockers completed:", job.blockers.length);

          return stateAdapter.withTransaction((ctx) =>
            complete({ ...ctx, output: { success: true } }),
          );
        },
      },
      auth: {
        attemptHandler: async ({ job, complete }) => {
          console.log(`Authenticating with token: ${job.input.token.substring(0, 8)}...`);

          return stateAdapter.withTransaction((ctx) =>
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
const chain = stateAdapter.withTransaction((ctx) =>
  client.createChain({
    ...ctx,
    typeName: "fetch-data",
    input: { url: "https://api.example.com/data" },
  }),
);

const result = await client.awaitChain(chain, { timeoutMs: 5000 });
console.log("Chain completed:", result.output);

console.log("\n=== Done ===");
