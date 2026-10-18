/**
 * Job Attempt Middleware Showcase
 *
 * A multi-tenant billing worker where every cross-cutting concern lives in
 * middleware instead of being repeated in each handler:
 *
 *   1. loggingMiddleware — wrapHandler: an attempt-scoped logger tagged with
 *      worker, job type and attempt number
 *   2. tenantMiddleware  — wrapPrepare: loads the tenant row inside the prepare
 *      transaction, so every handler starts with a consistent snapshot of it
 *   3. meteringMiddleware — wrapComplete: a `meter()` that records billable
 *      units in the *same* transaction as the job, so a failed attempt bills
 *      nothing, and reports to the metrics backend only after commit
 *
 * Scenarios:
 * 1. Happy path: issue-invoice continues with send-receipt; the invoice row,
 *    its usage records and job completion commit together
 * 2. Failed attempt: send-receipt throws after metering from the complete
 *    callback — the savepoint rolls the usage record back and metrics never see
 *    it; the retry bills the unit exactly once
 */

import assert from "node:assert/strict";

import { createPgNotifyAdapter, createPgStateAdapter } from "@queuert/postgres";
import { acquirePostgres } from "@queuert/testcontainers";
import { createPostgresJsNotifyProvider } from "example-notify-postgres-postgres-js/provider";
import { createPostgresJsStateProvider } from "example-state-postgres-postgres-js/provider";
import postgres from "postgres";
import {
  type AttemptMiddleware,
  type TransactionHooks,
  createClient,
  createInProcessWorker,
  createProcessors,
  defineJobTypes,
  withTransactionHooks,
} from "queuert";

const jobTypes = defineJobTypes<{
  /*
   * Workflow:
   *   issue-invoice --> send-receipt --> output { delivered }
   *
   * Middleware nesting for one attempt (wrapPrepare / wrapComplete bracket the
   * callbacks passed to prepare()/complete(), not the handler body):
   *
   *   loggingMiddleware.wrapHandler
   *     handler body starts
   *       prepare(...)  --> tenantMiddleware.wrapPrepare  --> callback
   *       complete(...) --> meteringMiddleware.wrapComplete --> callback
   *     handler body ends
   *   loggingMiddleware.wrapHandler
   */
  "issue-invoice": {
    entry: true;
    input: { tenantId: string; amountCents: number };
    continueWith: { typeName: "send-receipt" };
  };
  "send-receipt": {
    input: { tenantId: string; invoiceId: string };
    output: { delivered: true };
  };
}>();

await using pg = await acquirePostgres("postgres:18", import.meta.url);
const sql = postgres(pg.connectionString, { max: 10 });

const stateProvider = createPostgresJsStateProvider({ sql });
const stateAdapter = await createPgStateAdapter({ stateProvider });
await stateAdapter.migrateToLatest();
const notifyProvider = createPostgresJsNotifyProvider({ sql });
const notifyAdapter = await createPgNotifyAdapter({ notifyProvider });

await sql`
  CREATE TABLE tenant (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    billing_email TEXT NOT NULL
  )
`;
await sql`
  CREATE TABLE invoice (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenant (id),
    amount_cents INTEGER NOT NULL
  )
`;
await sql`
  CREATE TABLE usage_record (
    id SERIAL PRIMARY KEY,
    job_id UUID NOT NULL,
    tenant_id TEXT NOT NULL,
    unit TEXT NOT NULL,
    quantity INTEGER NOT NULL
  )
`;
await sql`INSERT INTO tenant (id, name, billing_email) VALUES ('acme', 'Acme Inc', 'billing@acme.example')`;

type Tenant = { id: string; name: string; billingEmail: string };

/** Every job type in this app is tenant-scoped, so middleware can rely on it. */
const tenantIdOf = (job: { input: unknown }) => (job.input as { tenantId: string }).tenantId;

const loggingMiddleware: AttemptMiddleware<
  typeof stateAdapter,
  { log: (message: string) => void }
> = {
  wrapHandler: async ({ job, workerId, next }) => {
    const prefix = `[${workerId.slice(0, 4)} ${job.typeName} #${job.attempt}]`;
    const startedAt = Date.now();
    try {
      return await next({
        log: (message) => {
          console.log(`${prefix} ${message}`);
        },
      });
    } catch (error) {
      console.error(`${prefix} attempt failed:`, error);
      throw error;
    } finally {
      console.log(`${prefix} attempt finished in ${Date.now() - startedAt}ms`);
    }
  },
};

const tenantMiddleware: AttemptMiddleware<
  typeof stateAdapter,
  Record<string, never>,
  { tenant: Tenant }
> = {
  wrapPrepare: async ({ job, txSql, next }) => {
    const [row] = await txSql<{ id: string; name: string; billing_email: string }[]>`
      SELECT id, name, billing_email FROM tenant WHERE id = ${tenantIdOf(job)}
    `;
    if (!row) throw new Error(`Unknown tenant ${tenantIdOf(job)}`);
    return next({ tenant: { id: row.id, name: row.name, billingEmail: row.billing_email } });
  },
};

const meteringHookKey = Symbol("example.metering");
const reportedUnits: string[] = [];

type Meter = (unit: string, quantity: number) => Promise<void>;

/**
 * Records a billable unit in the caller's transaction and queues the metrics
 * report for after commit. The record commits atomically with the job, so a
 * failed attempt bills nothing and reports nothing.
 */
const createMeter = (
  txSql: postgres.TransactionSql,
  transactionHooks: TransactionHooks,
  job: { id: string; input: unknown },
): Meter => {
  return async (unit, quantity) => {
    await txSql`
      INSERT INTO usage_record (job_id, tenant_id, unit, quantity)
      VALUES (${job.id}, ${tenantIdOf(job)}, ${unit}, ${quantity})
    `;
    const pending = transactionHooks.getOrInsert<string[]>(meteringHookKey, () => ({
      state: [],
      flush: (units) => {
        reportedUnits.push(...units);
        console.log(`    · metering: reported after commit — ${units.join(", ")}`);
      },
      checkpoint: (units) => {
        const mark = units.length;
        return () => {
          units.length = mark;
        };
      },
    }));
    pending.push(unit);
  };
};

const meteringMiddleware: AttemptMiddleware<
  typeof stateAdapter,
  Record<string, never>,
  Record<string, never>,
  { meter: Meter }
> = {
  wrapComplete: async ({ job, txSql, transactionHooks, next }) =>
    next({ meter: createMeter(txSql, transactionHooks, job) }),
};

const client = await createClient({
  stateAdapter,
  notifyAdapter,
  jobTypes,
});

const worker = await createInProcessWorker({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    attemptMiddleware: [loggingMiddleware, tenantMiddleware, meteringMiddleware],
    backoffConfig: { initialDelayMs: 100, multiplier: 1, maxDelayMs: 100 },
    processors: {
      "issue-invoice": {
        attemptHandler: async ({ job, log, prepare, complete }) => {
          const tenant = await prepare({ mode: "staged" }, async ({ tenant }) => tenant);
          log(`issuing invoice for ${tenant.name}`);

          const invoiceId = `inv-${job.id.slice(0, 8)}`;
          return complete(async ({ finish, txSql, meter }) => {
            await txSql`
              INSERT INTO invoice (id, tenant_id, amount_cents)
              VALUES (${invoiceId}, ${tenant.id}, ${job.input.amountCents})
              ON CONFLICT (id) DO NOTHING
            `;
            await meter("invoice.issued", 1);

            return finish({
              continueWith: {
                typeName: "send-receipt",
                input: { tenantId: tenant.id, invoiceId },
              },
            });
          });
        },
      },

      "send-receipt": {
        attemptHandler: async ({ job, log, prepare, complete }) => {
          const tenant = await prepare({ mode: "staged" }, async ({ tenant }) => tenant);

          // Delivery is billed from complete — only a delivered receipt is billable.
          log(`delivering receipt to ${tenant.billingEmail}`);

          return complete(async ({ finish, meter }) => {
            await meter("receipt.delivered", 1);
            if (job.attempt === 1) {
              log("smtp gateway unavailable — rolling back and retrying");
              throw new Error("smtp gateway unavailable");
            }
            return finish({ output: { delivered: true } });
          });
        },
      },
    },
  }),
});

const stopWorker = await worker.start();

console.log("--- issuing an invoice for tenant acme ---");
const chain = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (txSql) =>
    client.createChain({
      txSql,
      transactionHooks,
      typeName: "issue-invoice",
      input: { tenantId: "acme", amountCents: 9900 },
    }),
  ),
);
const result = await client.awaitChain(chain, { timeoutMs: 10_000 });

const usage = await sql<{ unit: string }[]>`SELECT unit FROM usage_record ORDER BY id`;
const invoices = await sql<{ id: string }[]>`SELECT id FROM invoice`;

console.log("\n--- result ---");
console.log(`output: ${JSON.stringify(result.output)}`);
console.log(`billed units: ${usage.map((row) => row.unit).join(", ")}`);
console.log(`reported to metrics after finish: ${reportedUnits.join(", ")}`);

assert.deepEqual(result.output, { delivered: true });
assert.equal(invoices.length, 1);

// The first send-receipt attempt metered "receipt.delivered" and then threw: the
// savepoint rolled the usage record back and metrics never saw it. The retry
// billed it once.
assert.deepEqual(
  usage.map((row) => row.unit),
  ["invoice.issued", "receipt.delivered"],
);
assert.deepEqual(reportedUnits, ["invoice.issued", "receipt.delivered"]);

await stopWorker();
await notifyAdapter.close();
await stateAdapter.close();
await sql.end();
