/**
 * Job Attempt Middleware Showcase
 *
 * A multi-tenant billing worker where every cross-cutting concern lives in
 * middleware instead of being repeated in each handler. Each one is a
 * wrapHandler that injects typed context into the handler:
 *
 *   1. loggingMiddleware — an attempt-scoped logger tagged with worker, job
 *      type and attempt number
 *   2. tenantMiddleware  — loads the tenant row before the handler runs
 *   3. meteringMiddleware — a `meter()` that records billable units in the
 *      transaction the handler passes it, never double-bills a retried attempt,
 *      and reports to the metrics backend only after commit
 *
 * Scenarios:
 * 1. Happy path: issue-invoice continues with send-receipt; the invoice row,
 *    its usage record and the continuation commit together
 * 2. Failed attempt: send-receipt throws after metering inside its finish
 *    transaction — the transaction rolls the usage record back and metrics never
 *    see it, while the unit committed earlier in its own transaction is not
 *    billed twice on retry
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
   * Middleware nesting for one attempt:
   *
   *   loggingMiddleware.wrapHandler          --> { log }
   *     tenantMiddleware.wrapHandler         --> { tenant }
   *       meteringMiddleware.wrapHandler     --> { meter }
   *         handler: work, then finish in its own transaction
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
    quantity INTEGER NOT NULL,
    UNIQUE (job_id, unit)
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

const tenantMiddleware: AttemptMiddleware<typeof stateAdapter, { tenant: Tenant }> = {
  wrapHandler: async ({ job, next }) => {
    const [row] = await sql<{ id: string; name: string; billing_email: string }[]>`
      SELECT id, name, billing_email FROM tenant WHERE id = ${tenantIdOf(job)}
    `;
    if (!row) throw new Error(`Unknown tenant ${tenantIdOf(job)}`);
    return next({ tenant: { id: row.id, name: row.name, billingEmail: row.billing_email } });
  },
};

const meteringHookKey = Symbol("example.metering");
const reportedUnits: string[] = [];

type Meter = (
  tx: { txSql: postgres.TransactionSql; transactionHooks: TransactionHooks },
  unit: string,
  quantity: number,
) => Promise<void>;

/**
 * Records a billable unit in the caller's transaction and queues the metrics
 * report for after commit. `UNIQUE (job_id, unit)` makes a retried attempt
 * re-metering the same unit a no-op, so the tenant is never billed twice.
 */
const meteringMiddleware: AttemptMiddleware<typeof stateAdapter, { meter: Meter }> = {
  wrapHandler: async ({ job, next }) =>
    next({
      meter: async ({ txSql, transactionHooks }, unit, quantity) => {
        const inserted = await txSql`
          INSERT INTO usage_record (job_id, tenant_id, unit, quantity)
          VALUES (${job.id}, ${tenantIdOf(job)}, ${unit}, ${quantity})
          ON CONFLICT (job_id, unit) DO NOTHING
          RETURNING id
        `;
        if (inserted.length === 0) {
          console.log(`    · metering: ${unit} already billed by an earlier attempt`);
          return;
        }
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
      },
    }),
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
        attemptHandler: async ({ job, log, tenant, meter, finish }) => {
          log(`issuing invoice for ${tenant.name}`);

          const invoiceId = `inv-${job.id.slice(0, 8)}`;
          return withTransactionHooks(async (transactionHooks) =>
            sql.begin(async (txSql) => {
              await txSql`
                INSERT INTO invoice (id, tenant_id, amount_cents)
                VALUES (${invoiceId}, ${tenant.id}, ${job.input.amountCents})
                ON CONFLICT (id) DO NOTHING
              `;
              await meter({ txSql, transactionHooks }, "invoice.issued", 1);

              return finish({
                txSql,
                transactionHooks,
                continueWith: {
                  typeName: "send-receipt",
                  input: { tenantId: tenant.id, invoiceId },
                },
              });
            }),
          );
        },
      },

      "send-receipt": {
        attemptHandler: async ({ job, log, tenant, meter, finish }) => {
          // Rendering is billed in its own transaction: the work is already done,
          // so the unit survives a later failure. Delivery is billed in the finish
          // transaction — only a delivered receipt is billable.
          await withTransactionHooks(async (transactionHooks) =>
            sql.begin(async (txSql) => meter({ txSql, transactionHooks }, "receipt.rendered", 1)),
          );

          log(`delivering receipt to ${tenant.billingEmail}`);

          return withTransactionHooks(async (transactionHooks) =>
            sql.begin(async (txSql) => {
              await meter({ txSql, transactionHooks }, "receipt.delivered", 1);
              if (job.attempt === 1) {
                log("smtp gateway unavailable — rolling back and retrying");
                throw new Error("smtp gateway unavailable");
              }
              return finish({ txSql, transactionHooks, output: { delivered: true } });
            }),
          );
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

// The first send-receipt attempt metered "receipt.delivered" and then threw: its
// transaction rolled the usage record back and metrics never saw it. The retry
// billed it once, while "receipt.rendered" — committed in its own transaction
// before the failure — was deduplicated instead of billed twice.
assert.deepEqual(
  usage.map((row) => row.unit),
  ["invoice.issued", "receipt.rendered", "receipt.delivered"],
);
assert.deepEqual(reportedUnits, ["invoice.issued", "receipt.rendered", "receipt.delivered"]);

await stopWorker();
await notifyAdapter.close();
await stateAdapter.close();
await sql.end();
