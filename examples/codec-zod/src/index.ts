/**
 * Bidirectional Codec Example
 *
 * Job inputs and outputs must be JSON-serializable at rest, but handlers are
 * nicer to write against real runtime types. A codec bridges the two: `Date`
 * in the handler, ISO string in the database.
 *
 * This example carries a `Date` from chain creation, through a `continueWith`
 * hop, into the completed output, and back out of a client read.
 */

import {
  createClient,
  createInProcessNotifyAdapter,
  createInProcessStateAdapter,
  createInProcessWorker,
  createProcessors,
  withTransactionHooks,
} from "queuert";
import { z } from "zod";

import { createZodCodecJobTypes } from "./zod-codec-adapter.js";

const zDate = z.codec(z.iso.datetime(), z.date(), {
  decode: (iso) => new Date(iso),
  encode: (date) => date.toISOString(),
});

const jobTypes = createZodCodecJobTypes({
  //  schedule-report ──▶ render-report
  "schedule-report": {
    entry: true,
    input: z.object({ reportId: z.string(), runAt: zDate }),
    continueWith: z.object({ typeName: z.literal("render-report") }),
  },

  "render-report": {
    input: z.object({ reportId: z.string(), from: zDate, to: zDate }),
    output: z.object({ renderedAt: zDate, rowCount: z.number() }),
  },
});

const stateAdapter = await createInProcessStateAdapter();
const notifyAdapter = await createInProcessNotifyAdapter();

const client = await createClient({ stateAdapter, notifyAdapter, jobTypes });

const worker = await createInProcessWorker({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      "schedule-report": {
        attemptHandler: async ({ job, complete }) => {
          console.log(
            `runAt is a ${job.input.runAt.constructor.name}: ${job.input.runAt.toISOString()}`,
          );

          const from = new Date(job.input.runAt.getTime() - 24 * 60 * 60 * 1000);
          return complete(async ({ continueWith }) =>
            continueWith({
              typeName: "render-report",
              input: { reportId: job.input.reportId, from, to: job.input.runAt },
            }),
          );
        },
      },
      "render-report": {
        attemptHandler: async ({ job, complete }) => {
          const hours = (job.input.to.getTime() - job.input.from.getTime()) / 3_600_000;
          console.log(`Rendering ${job.input.reportId} over a ${hours}h window`);

          return complete(async () => ({ renderedAt: new Date(), rowCount: 128 }));
        },
      },
    },
  }),
});

const stopWorker = await worker.start();

const runAt = new Date("2024-06-01T09:00:00.000Z");
const chain = await withTransactionHooks(async (transactionHooks) =>
  stateAdapter.withTransaction(async (ctx) =>
    client.createChain({
      ...ctx,
      transactionHooks,
      typeName: "schedule-report",
      input: { reportId: "weekly-sales", runAt },
    }),
  ),
);

const result = await client.awaitChain(chain, { timeoutMs: 5000 });
console.log(`\nrenderedAt is a ${result.output.renderedAt.constructor.name}`);
console.log(`rowCount: ${result.output.rowCount}`);

const readBack = await client.getJob({ id: chain.id, typeName: "schedule-report" });
console.log(`\nRead back from the client: runAt is a ${readBack?.input.runAt.constructor.name}`);
console.log(
  `Round-trip preserved the instant: ${readBack?.input.runAt.getTime() === runAt.getTime()}`,
);

await stopWorker();
await notifyAdapter.close();
await stateAdapter.close();
console.log("\n=== Done ===");
