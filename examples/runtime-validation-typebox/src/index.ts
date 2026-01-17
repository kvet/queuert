/**
 * Runtime Validation with TypeBox Example
 *
 * This example demonstrates how to use TypeBox for runtime validation of job types.
 * It shows:
 * 1. Creating a TypeBox-based job type registry
 * 2. Nominal reference validation (by type name)
 * 3. Structural reference validation (by input shape)
 */

import { Type } from "@sinclair/typebox";
import { createConsoleLog, createQueuert } from "queuert";
import { createInProcessNotifyAdapter, createInProcessStateAdapter } from "queuert/internal";
import { createTypeBoxJobTypeRegistry } from "./typebox-adapter.js";

// URL format for TypeBox (simplified pattern)
const UrlString = Type.String({ pattern: "^https?://" });

// 1. Define job types with TypeBox schemas
const jobTypeRegistry = createTypeBoxJobTypeRegistry({
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

// 2. Create queuert with the registry
const stateAdapter = createInProcessStateAdapter();

const qrt = await createQueuert({
  stateAdapter,
  notifyAdapter: createInProcessNotifyAdapter(),
  log: createConsoleLog(),
  jobTypeRegistry,
});

// 3. Implement workers
const worker = qrt
  .createWorker()
  .implementJobType({
    typeName: "fetch-data",
    process: async ({ job, complete }) => {
      console.log(`Fetching data from ${job.input.url}`);
      const data = { items: [1, 2, 3], source: job.input.url };

      return complete(async ({ continueWith }) =>
        continueWith({
          typeName: "process-data",
          input: { data },
        }),
      );
    },
  })
  .implementJobType({
    typeName: "process-data",
    process: async ({ job, complete }) => {
      console.log("Processing data:", job.input.data);
      const data = job.input.data as { items: number[] };

      return complete(async () => ({
        processed: true,
        itemCount: data.items?.length ?? 0,
      }));
    },
  })
  .implementJobType({
    typeName: "batch-process",
    process: async ({ job, complete }) => {
      console.log(`Processing batch ${job.input.batchId}`);
      console.log("Blockers completed:", job.blockers.length);

      return complete(async () => ({
        success: true,
      }));
    },
  })
  .implementJobType({
    typeName: "auth",
    process: async ({ job, complete }) => {
      console.log(`Authenticating with token: ${job.input.token.substring(0, 8)}...`);
      return complete(async () => ({
        userId: `user-${job.input.token.substring(0, 4)}`,
      }));
    },
  });

const stopWorker = await worker.start({ workerId: "worker-1" });

// 4. Run a chain
console.log("\n=== Running fetch-data chain ===");
const chain = await qrt.withNotify(async () =>
  stateAdapter.provideContext(async (ctx) =>
    stateAdapter.runInTransaction(ctx, async (ctx) =>
      qrt.startJobChain({
        ...ctx,
        typeName: "fetch-data",
        input: { url: "https://api.example.com/data" },
      }),
    ),
  ),
);

const result = await qrt.waitForJobChainCompletion(chain, { timeoutMs: 5000 });
console.log("Chain completed:", result.output);

// 5. Cleanup
await stopWorker();
console.log("\n=== Done ===");
