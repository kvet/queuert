import { createClient, createProcessors, createWorkerRunner } from "queuert";

import { openDatabase } from "./db.ts";
import { jobTypes } from "./job-types.ts";

await using db = await openDatabase();
const { stateAdapter } = db;
const client = createClient({ stateAdapter, jobTypes });

const callProvider = async (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const processors = createProcessors({
  client,
  jobTypes,
  processors: {
    "capture-payment": {
      attemptHandler: async ({ job, applyJobOutcome }) => {
        await callProvider(150);
        console.log(`Captured the payment for ${job.input.orderId}`);
        await stateAdapter.withTransaction(async (txCtx) =>
          applyJobOutcome({ ...txCtx, output: { paymentId: `pay-${job.input.orderId}` } }),
        );
      },
    },
    "reserve-stock": {
      attemptHandler: async ({ job, applyJobOutcome }) => {
        await callProvider(50);
        console.log(`Reserved the stock for ${job.input.orderId}`);
        await stateAdapter.withTransaction(async (txCtx) =>
          applyJobOutcome({ ...txCtx, output: { reservationId: `res-${job.input.orderId}` } }),
        );
      },
    },
    "ship-order": {
      attemptHandler: async ({ job, applyJobOutcome }) => {
        console.log(`Shipping ${job.input.orderId}`);
        await stateAdapter.withTransaction(async (txCtx) =>
          applyJobOutcome({ ...txCtx, output: { trackingNumber: `track-${job.input.orderId}` } }),
        );
      },
    },
  },
});

await using workerRunner = createWorkerRunner({ client, processors, concurrency: 3 });
await workerRunner.start();

const shipping = await stateAdapter.withTransaction(async (txCtx) => {
  const input = { orderId: "order-1" };
  const payment = await client.createChain({ ...txCtx, typeName: "capture-payment", input });
  const stock = await client.createChain({ ...txCtx, typeName: "reserve-stock", input });
  return client.createChain({
    ...txCtx,
    typeName: "ship-order",
    input,
    blockers: [payment, stock],
  });
});
await client.awaitChain({ chain: shipping, timeoutMs: 5000 });
