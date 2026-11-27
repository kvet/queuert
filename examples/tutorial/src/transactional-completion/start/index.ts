import { createClient, createProcessors, createWorkerRunner, defineJobTypes } from "queuert";

import { openDatabase } from "./db.ts";

const jobTypes = defineJobTypes<{
  "reserve-stock": {
    entry: true;
    input: { orderId: string; sku: string; quantity: number };
    output: { reservedAt: string };
  };
}>();

await using db = await openDatabase();
const { stateAdapter, sql } = db;
const client = createClient({ stateAdapter, jobTypes });

await sql()`CREATE TABLE products (sku TEXT PRIMARY KEY, stock INTEGER NOT NULL)`;
await sql()`INSERT INTO products (sku, stock) VALUES ('lamp', 10)`;

const processors = createProcessors({
  client,
  jobTypes,
  processors: {
    "reserve-stock": {
      backoffConfig: { initialDelayMs: 20, maxDelayMs: 200 },
      attemptHandler: async ({ job, applyJobOutcome }) => {
        const { sku, quantity } = job.input;
        console.log(`Reserving ${quantity} × ${sku}, attempt ${job.attempt}`);
        await sql()`UPDATE products SET stock = stock - ${quantity} WHERE sku = ${sku}`;
        await stateAdapter.withTransaction(async (txCtx) => {
          if (job.attempt === 1) throw new Error("The worker crashed before completing the job");
          return applyJobOutcome({ ...txCtx, output: { reservedAt: new Date().toISOString() } });
        });
      },
    },
  },
});

await using workerRunner = createWorkerRunner({ client, processors });
await workerRunner.start();

const chain = await stateAdapter.withTransaction(async (txCtx) =>
  client.createChain({
    ...txCtx,
    typeName: "reserve-stock",
    input: { orderId: "order-1", sku: "lamp", quantity: 2 },
  }),
);
await client.awaitChain({ chain, timeoutMs: 5000 });

const [lamp] = await sql()<{ stock: number }>`SELECT stock FROM products WHERE sku = 'lamp'`;
console.log(`Lamps in stock: ${lamp.stock}`);
