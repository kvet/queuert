import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";

import {
  createClient,
  createInProcessStateAdapter,
  createProcessors,
  createWorkerRunner,
  defineJobTypes,
} from "queuert";

const jobTypes = defineJobTypes<{
  /*
   * charge-payment: payment API fails before the transaction --> rescheduled
   */
  "charge-payment": {
    entry: true;
    input: { orderId: string };
    output: { paymentId: string };
  };
  /*
   * transfer-funds: balance check fails inside the transaction --> rolled back, rescheduled
   */
  "transfer-funds": {
    entry: true;
    input: { fromAccountId: string; toAccountId: string; amountCents: number };
    output: { transferred: true };
  };
  /*
   * sync-item: intermediate transaction commits, external API fails --> rescheduled, runs again
   */
  "sync-item": {
    entry: true;
    input: { itemId: string };
    output: { externalId: string };
  };
  /*
   * notify-account: completion commits, notification fails afterwards --> stays completed
   */
  "notify-account": {
    entry: true;
    input: { accountId: string };
    output: { notified: true };
  };
}>();

type TxContext = Parameters<typeof stateAdapter.onTransactionRollback>[0];

const orders = new Map<string, { amountCents: number; paymentId: string | null }>([
  ["order-1", { amountCents: 4200, paymentId: null }],
]);
const accounts = new Map([
  ["alice", 10_000],
  ["bob", 5000],
]);
const items = new Map<string, { syncStarts: number; externalId: string | null }>([
  ["item-1", { syncStarts: 0, externalId: null }],
]);

const updateBalance = (txCtx: TxContext, accountId: string, deltaCents: number): void => {
  const balance = accounts.get(accountId)! + deltaCents;
  if (balance < 0) throw new Error(`balance of ${accountId} must not go negative`);
  accounts.set(accountId, balance);
  stateAdapter.onTransactionRollback(txCtx, () => {
    accounts.set(accountId, accounts.get(accountId)! - deltaCents);
  });
};

const externalFailures = new Map([
  ["payment", [new Error("payment API timed out")]],
  ["sync", [new Error("sync API unavailable")]],
  ["notification", [new Error("notification API unavailable")]],
]);
const callExternalApi = async <T>(api: string, response: T): Promise<T> => {
  const failure = externalFailures.get(api)!.shift();
  if (failure !== undefined) throw failure;
  return response;
};
const paymentCharges = new Map<string, number>();
const paymentApi = {
  charge: async (idempotencyKey: string, amountCents: number) => {
    paymentCharges.set(idempotencyKey, amountCents);
    return callExternalApi("payment", { paymentId: `pay-${paymentCharges.size}` });
  },
};
const externalApi = {
  sync: async (itemId: string) => callExternalApi("sync", `ext-${itemId}`),
};
const notificationApi = {
  send: async (_accountId: string) => callExternalApi("notification", undefined),
};

await using stateAdapter = createInProcessStateAdapter({ mode: "async" });
const client = createClient({ stateAdapter, jobTypes });

await using workerRunner = createWorkerRunner({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    backoffConfig: { initialDelayMs: 10, maxDelayMs: 10 },
    processors: {
      // #region before-transaction
      "charge-payment": {
        backoffConfig: { initialDelayMs: 1000, multiplier: 2, maxDelayMs: 60_000 },
        attemptHandler: async ({ job, applyOutcome }) => {
          const order = orders.get(job.input.orderId);
          if (order === undefined) throw new Error("Order not found");

          const { paymentId } = await paymentApi.charge(job.id, order.amountCents);

          return stateAdapter.withTransaction(async (txCtx) => {
            orders.set(job.input.orderId, { ...order, paymentId });
            return applyOutcome({ ...txCtx, output: { paymentId } });
          });
        },
      },
      // #endregion
      // #region inside-transaction
      "transfer-funds": {
        attemptHandler: async ({ job, applyOutcome }) =>
          stateAdapter.withTransaction(async (txCtx) => {
            updateBalance(txCtx, job.input.toAccountId, job.input.amountCents);
            updateBalance(txCtx, job.input.fromAccountId, -job.input.amountCents);
            return applyOutcome({ ...txCtx, output: { transferred: true } });
          }),
      },
      // #endregion
      // #region intermediate-transaction
      "sync-item": {
        attemptHandler: async ({ job, applyOutcome }) => {
          const item = await stateAdapter.withTransaction(async () => {
            const current = items.get(job.input.itemId)!;
            const started = { ...current, syncStarts: current.syncStarts + 1 };
            items.set(job.input.itemId, started);
            return started;
          });

          const externalId = await externalApi.sync(job.input.itemId);

          return stateAdapter.withTransaction(async (txCtx) => {
            items.set(job.input.itemId, { ...item, externalId });
            return applyOutcome({ ...txCtx, output: { externalId } });
          });
        },
      },
      // #endregion
      // #region after-commit
      "notify-account": {
        attemptHandler: async ({ job, applyOutcome }) => {
          const result = await stateAdapter.withTransaction(async (txCtx) =>
            applyOutcome({ ...txCtx, output: { notified: true } }),
          );

          await notificationApi.send(job.input.accountId);

          return result;
        },
      },
      // #endregion
    },
  }),
});
await workerRunner.start();

const paymentChain = await stateAdapter.withTransaction(async (txCtx) =>
  client.createChain({ ...txCtx, typeName: "charge-payment", input: { orderId: "order-1" } }),
);
const payment = await client.awaitChain({ chain: paymentChain, timeoutMs: 5000 });
assert.equal(payment.output.paymentId, "pay-1");
assert.deepEqual([...paymentCharges.values()], [4200]);
assert.equal(orders.get("order-1")!.paymentId, "pay-1");

const transferChain = await stateAdapter.withTransaction(async (txCtx) =>
  client.createChain({
    ...txCtx,
    typeName: "transfer-funds",
    input: { fromAccountId: "bob", toAccountId: "alice", amountCents: 20_000 },
  }),
);
while ((await client.getJob({ id: transferChain.id }))!.consecutiveFailures === 0) {
  await setTimeout(10);
}
assert.deepEqual(Object.fromEntries(accounts), { alice: 10_000, bob: 5000 });
await stateAdapter.withTransaction(async (txCtx) => {
  updateBalance(txCtx, "bob", 25_000);
});
await client.awaitChain({ chain: transferChain, timeoutMs: 5000 });
assert.deepEqual(Object.fromEntries(accounts), { alice: 30_000, bob: 10_000 });
assert.ok((await client.getJob({ id: transferChain.id }))!.attempt > 1);

const syncChain = await stateAdapter.withTransaction(async (txCtx) =>
  client.createChain({ ...txCtx, typeName: "sync-item", input: { itemId: "item-1" } }),
);
await client.awaitChain({ chain: syncChain, timeoutMs: 5000 });
assert.deepEqual(items.get("item-1"), { syncStarts: 2, externalId: "ext-item-1" });

const notifyChain = await stateAdapter.withTransaction(async (txCtx) =>
  client.createChain({ ...txCtx, typeName: "notify-account", input: { accountId: "alice" } }),
);
const notification = await client.awaitChain({ chain: notifyChain, timeoutMs: 5000 });
assert.deepEqual(notification.output, { notified: true });
assert.equal((await client.getJob({ id: notifyChain.id }))!.attempt, 1);
