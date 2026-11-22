import assert from "node:assert/strict";

import {
  createClient,
  createInProcessStateAdapter,
  createProcessors,
  createWorkerRunner,
  defineJobTypes,
} from "queuert";

// #region fan-out-types
const jobTypes = defineJobTypes<{
  /*
   * fetch-data #1 --+
   * fetch-data #2 --+--> process-all
   * fetch-data #3 --+
   */
  "fetch-data": {
    entry: true;
    input: { url: string };
    output: { data: string };
  };
  "process-all": {
    entry: true;
    input: { reportId: string };
    output: { results: string[] };
    blockers: [{ typeName: "fetch-data" }, ...{ typeName: "fetch-data" }[]];
  };
  // #hide

  /*
   * capture-payment (ID kept on the order while it awaits payment) --> ship-order
   */
  "capture-payment": {
    entry: true;
    input: { orderId: string };
    output: { transactionId: string };
  };
  "ship-order": {
    entry: true;
    input: { orderId: string };
    output: { trackingNumber: string };
    blockers: [...{ typeName: "capture-payment" }[]];
  };
  // #endhide
}>();
// #endregion

type Order = { status: "awaiting_payment" | "paid" | "shipped"; paymentChainId: string | null };
const orders = new Map<string, Order>();

await using stateAdapter = createInProcessStateAdapter({ mode: "async" });
const client = createClient({ stateAdapter, jobTypes });

await using workerRunner = createWorkerRunner({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      "fetch-data": {
        attemptHandler: async ({ job, complete }) =>
          stateAdapter.withTransaction(async (txCtx) =>
            complete({ ...txCtx, output: { data: `data from ${job.input.url}` } }),
          ),
      },
      // #region fan-out-process
      "process-all": {
        attemptHandler: async ({ job, complete }) => {
          const results = job.blockers.map((blocker) => blocker.output.data);
          return stateAdapter.withTransaction(async (txCtx) =>
            complete({ ...txCtx, output: { results } }),
          );
        },
      },
      // #endregion
      "capture-payment": {
        attemptHandler: async ({ job, complete }) =>
          stateAdapter.withTransaction(async (txCtx) => {
            orders.set(job.input.orderId, { status: "paid", paymentChainId: null });
            return complete({ ...txCtx, output: { transactionId: `txn-${job.input.orderId}` } });
          }),
      },
      "ship-order": {
        attemptHandler: async ({ job, complete }) =>
          stateAdapter.withTransaction(async (txCtx) => {
            orders.set(job.input.orderId, { status: "shipped", paymentChainId: null });
            return complete({ ...txCtx, output: { trackingNumber: `track-${job.input.orderId}` } });
          }),
      },
    },
  }),
});
await workerRunner.start();

// #region fan-out-create
const reportChain = await stateAdapter.withTransaction(async (txCtx) => {
  const fetchChains = await client.createChains({
    ...txCtx,
    items: [
      { typeName: "fetch-data", input: { url: "/users" } },
      { typeName: "fetch-data", input: { url: "/orders" } },
      { typeName: "fetch-data", input: { url: "/products" } },
    ],
  });
  return client.createChain({
    ...txCtx,
    typeName: "process-all",
    input: { reportId: "report-1" },
    blockers: fetchChains,
  });
});
// #endregion

const report = await client.awaitChain({ chain: reportChain, timeoutMs: 5000 });
assert.deepEqual(report.output.results, [
  "data from /users",
  "data from /orders",
  "data from /products",
]);

await stateAdapter.withTransaction(async (txCtx) => {
  const paymentChain = await client.createChain({
    ...txCtx,
    typeName: "capture-payment",
    input: { orderId: "order-1" },
  });
  orders.set("order-1", { status: "awaiting_payment", paymentChainId: paymentChain.id });
});

// #region by-id-create
const shipChain = await stateAdapter.withTransaction(async (txCtx) => {
  const order = orders.get("order-1")!;
  return client.createChain({
    ...txCtx,
    typeName: "ship-order",
    input: { orderId: "order-1" },
    blockers:
      order.status === "awaiting_payment" && order.paymentChainId !== null
        ? [{ id: order.paymentChainId }]
        : [],
  });
});
// #endregion

const shipment = await client.awaitChain({ chain: shipChain, timeoutMs: 5000 });
assert.equal(shipment.output.trackingNumber, "track-order-1");
assert.equal(orders.get("order-1")!.status, "shipped");
