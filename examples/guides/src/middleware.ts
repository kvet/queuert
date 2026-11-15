import assert from "node:assert/strict";

import {
  type AttemptMiddleware,
  createClient,
  createInProcessStateAdapter,
  createProcessors,
  createWorkerRunner,
  defineJobTypes,
} from "queuert";

const billingJobTypes = defineJobTypes<{
  /*
   * issue-invoice --> output { invoiceId }
   *
   * Middleware nesting for one issue-invoice attempt:
   *
   *   tracing      --> { traceId }
   *     loadTenant --> { tenant }
   *       audit    --> { audit }
   *         attemptHandler
   */
  "issue-invoice": {
    entry: true;
    input: { tenantId: string; amountCents: number };
    output: { invoiceId: string };
  };
}>();

const notificationJobTypes = defineJobTypes<{
  /*
   * send-receipt --> output { delivered }
   */
  "send-receipt": {
    entry: true;
    input: { tenantId: string; invoiceId: string };
    output: { delivered: true };
  };
}>();

type TxContext = Parameters<typeof stateAdapter.onTransactionRollback>[0];
type Tenant = { id: string; name: string; billingEmail: string };
type Span = { traceId: string; name: string; status: "ok" | "error" };

const tenants = new Map<string, Tenant>([
  ["acme", { id: "acme", name: "Acme Inc", billingEmail: "billing@acme.example" }],
]);
const spans: Span[] = [];
const auditEvents: { jobId: string; event: string }[] = [];
const invoices: { id: string; tenantId: string; amountCents: number; traceId: string }[] = [];
const receipts: string[] = [];

const insertRow = <TRow>(txCtx: TxContext, table: TRow[], row: TRow): void => {
  table.push(row);
  stateAdapter.onTransactionRollback(txCtx, () => {
    table.splice(table.indexOf(row), 1);
  });
};
const invoiceStoreFailures = [new Error("could not serialize access due to concurrent update")];
const insertInvoice = (txCtx: TxContext, invoice: (typeof invoices)[number]): void => {
  insertRow(txCtx, invoices, invoice);
  const failure = invoiceStoreFailures.shift();
  if (failure !== undefined) throw failure;
};

await using stateAdapter = createInProcessStateAdapter({ mode: "async" });
const client = createClient({
  stateAdapter,
  jobTypes: [billingJobTypes, notificationJobTypes],
});

// #region tracing
const tracing: AttemptMiddleware<typeof stateAdapter, { traceId: string }> = {
  wrapHandler: async ({ job, next }) => {
    const traceId = crypto.randomUUID();
    const name = `${job.typeName} #${job.attempt}`;
    try {
      const result = await next({ traceId });
      spans.push({ traceId, name, status: "ok" });
      return result;
    } catch (error) {
      spans.push({ traceId, name, status: "error" });
      throw error;
    }
  },
};
// #endregion

// #region load-tenant
const loadTenant: AttemptMiddleware<typeof stateAdapter, { tenant: Tenant }> = {
  wrapHandler: async ({ job, next }) => {
    const { tenantId } = job.input as { tenantId: string };
    const tenant = tenants.get(tenantId);
    if (tenant === undefined) throw new Error(`Unknown tenant ${tenantId}`);
    return next({ tenant });
  },
};
// #endregion

// #region audit
const audit: AttemptMiddleware<
  typeof stateAdapter,
  { audit: (txCtx: TxContext, event: string) => void }
> = {
  wrapHandler: async ({ job, next }) =>
    next({
      audit: (txCtx, event) => {
        insertRow(txCtx, auditEvents, { jobId: job.id, event });
      },
    }),
};
// #endregion

// #region registries
const billingProcessors = createProcessors({
  client,
  jobTypes: billingJobTypes,
  attemptMiddleware: [tracing, loadTenant, audit],
  // #hide
  backoffConfig: { initialDelayMs: 10, maxDelayMs: 10 },
  processors: {
    // #region issue-invoice
    "issue-invoice": {
      attemptHandler: async ({ job, traceId, tenant, audit, complete }) => {
        const invoiceId = `inv-${job.id}`;
        return stateAdapter.withTransaction(async (txCtx) => {
          audit(txCtx, "invoice-issued");
          insertInvoice(txCtx, {
            id: invoiceId,
            tenantId: tenant.id,
            amountCents: job.input.amountCents,
            traceId,
          });
          return complete({ ...txCtx, output: { invoiceId } });
        });
      },
    },
    // #endregion
  },
  // #endhide
});

const notificationProcessors = createProcessors({
  client,
  jobTypes: notificationJobTypes,
  attemptMiddleware: [tracing, loadTenant],
  // #hide
  processors: {
    "send-receipt": {
      attemptHandler: async ({ job, tenant, complete }) =>
        stateAdapter.withTransaction(async (txCtx) => {
          receipts.push(`${job.input.invoiceId} to ${tenant.billingEmail}`);
          return complete({ ...txCtx, output: { delivered: true } });
        }),
    },
  },
  // #endhide
});
// #endregion

// #region worker
await using workerRunner = createWorkerRunner({
  client,
  processors: [billingProcessors, notificationProcessors],
});
// #endregion
await workerRunner.start();

const invoiceChain = await stateAdapter.withTransaction(async (txCtx) =>
  client.createChain({
    ...txCtx,
    typeName: "issue-invoice",
    input: { tenantId: "acme", amountCents: 9900 },
  }),
);
const { invoiceId } = (await client.awaitChain(invoiceChain, { timeoutMs: 5000 })).output;
assert.equal(invoiceId, `inv-${invoiceChain.id}`);

const receiptChain = await stateAdapter.withTransaction(async (txCtx) =>
  client.createChain({
    ...txCtx,
    typeName: "send-receipt",
    input: { tenantId: "acme", invoiceId },
  }),
);
const receipt = await client.awaitChain(receiptChain, { timeoutMs: 5000 });
assert.deepEqual(receipt.output, { delivered: true });
await workerRunner.stop();

assert.deepEqual(
  spans.map((span) => [span.name, span.status]),
  [
    ["issue-invoice #1", "error"],
    ["issue-invoice #2", "ok"],
    ["send-receipt #1", "ok"],
  ],
);
assert.deepEqual(auditEvents, [{ jobId: invoiceChain.id, event: "invoice-issued" }]);
assert.deepEqual(invoices, [
  { id: invoiceId, tenantId: "acme", amountCents: 9900, traceId: spans[1].traceId },
]);
assert.deepEqual(receipts, [`${invoiceId} to billing@acme.example`]);
