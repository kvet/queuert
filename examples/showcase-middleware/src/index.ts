/**
 * Job Attempt Middleware Showcase
 *
 * Demonstrates all three middleware hooks and how typed ctx flows into the handler:
 *   1. wrapHandler  — injects a trace id (and logs around the entire attempt)
 *   2. wrapPrepare  — preloads shared data inside the prepare transaction
 *   3. wrapComplete — provides an audit helper the handler can call at completion
 *
 * Two middlewares are composed as an onion to make the order visible in output.
 */

import assert from "node:assert/strict";

import { createPgNotifyAdapter, createPgStateAdapter } from "@queuert/postgres";
import { acquirePostgres } from "@queuert/testcontainers";
import { createPostgresJsNotifyProvider } from "example-notify-postgres-postgres-js/provider";
import { createPostgresJsStateProvider } from "example-state-postgres-postgres-js/provider";
import postgres from "postgres";
import {
  type AttemptMiddleware,
  createClient,
  createInProcessWorker,
  createProcessors,
  defineJobTypes,
  withTransactionHooks,
} from "queuert";

const jobTypes = defineJobTypes<{
  /*
   * Workflow:
   *   send-invoice --> output { invoiceId }
   *
   * Phase nesting (wrapPrepare / wrapComplete bracket the user's
   * prepare()/complete() calls *inside* the handler body, not the body itself):
   *
   *   tracingMiddleware.wrapHandler  (before — frames the whole attempt)
   *     handler body starts
   *       prepare(...) called
   *         resourceMiddleware.wrapPrepare  (before)
   *           prepare callback runs
   *         resourceMiddleware.wrapPrepare  (after)
   *       complete(...) called
   *         resourceMiddleware.wrapComplete (before)
   *           complete callback runs
   *         resourceMiddleware.wrapComplete (after)
   *     handler body ends
   *   tracingMiddleware.wrapHandler  (after)
   */
  "send-invoice": {
    entry: true;
    input: { userId: string; amount: number };
    output: { invoiceId: string };
  };
}>();

// Middleware 1: tracing — injects traceId and frames the attempt in logs.
const tracingMiddleware: AttemptMiddleware<any, { traceId: string }> = {
  wrapHandler: async ({ job, next }) => {
    const traceId = `t-${Math.random().toString(36).slice(2, 8)}`;
    console.log(`[${traceId}] → handler start (${job.typeName})`);
    try {
      const result = await next({ traceId });
      console.log(`[${traceId}] ← handler end`);
      return result;
    } catch (error) {
      console.log(`[${traceId}] × handler failed`);
      throw error;
    }
  },
};

// Middleware 2: resource preload + audit helper.
//   wrapPrepare runs inside the prepare transaction — use txCtx for consistent reads.
//   wrapComplete runs inside the complete transaction — use it for post-completion
//   side effects like audit rows or outbox inserts.
type User = { id: string; email: string };
const auditLog: { event: string; userId: string; invoiceId?: string }[] = [];

const resourceMiddleware: AttemptMiddleware<
  any,
  {},
  { user: User },
  { audit: (event: string, extra?: { invoiceId?: string }) => void }
> = {
  wrapPrepare: async ({ job, next }) => {
    // In a real app, query the DB with the surrounding txCtx. Here we synthesize.
    const userId = (job.input as { userId: string }).userId;
    const user: User = { id: userId, email: `${userId}@example.com` };
    console.log(`    · prepare: preloaded ${user.email}`);
    return next({ user });
  },
  wrapComplete: async ({ job, next }) => {
    const userId = (job.input as { userId: string }).userId;
    return next({
      audit: (event, extra) => {
        auditLog.push({ event, userId, ...extra });
        console.log(`    · complete: audit(${event}${extra ? ` ${JSON.stringify(extra)}` : ""})`);
      },
    });
  },
};

await using pg = await acquirePostgres("postgres:18", import.meta.url);
const sql = postgres(pg.connectionString, { max: 10 });

const stateProvider = createPostgresJsStateProvider({ sql });
const stateAdapter = await createPgStateAdapter({ stateProvider });
await stateAdapter.migrateToLatest();
const notifyProvider = createPostgresJsNotifyProvider({ sql });
const notifyAdapter = await createPgNotifyAdapter({ notifyProvider });

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
    attemptMiddleware: [tracingMiddleware, resourceMiddleware],
    processors: {
      "send-invoice": {
        attemptHandler: async ({ traceId, prepare, complete }) => {
          // traceId injected by tracingMiddleware.wrapHandler
          console.log(`  · handler: running (traceId=${traceId})`);

          // prepare callback receives typed ctx injected by resourceMiddleware.wrapPrepare
          const user = await prepare({ mode: "staged" }, async ({ user }) => user);
          console.log(`  · handler: preloaded user.email=${user.email}`);

          return complete(async ({ audit }) => {
            // audit injected by resourceMiddleware.wrapComplete
            const invoiceId = `inv-${Date.now()}`;
            audit("invoice-created", { invoiceId });
            return { invoiceId };
          });
        },
      },
    },
  }),
});

const stopWorker = await worker.start();

console.log("--- processing send-invoice job ---");
const jobChain = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (txSql) =>
    client.startJobChain({
      sql: txSql,
      transactionHooks,
      typeName: "send-invoice",
      input: { userId: "u-42", amount: 9900 },
    }),
  ),
);
const result = await client.awaitJobChain(jobChain, { timeoutMs: 5000 });

console.log("\n--- result ---");
console.log(`output: ${JSON.stringify(result.output)}`);
console.log(`audit log: ${JSON.stringify(auditLog, null, 2)}`);

assert.ok(result.output.invoiceId.startsWith("inv-"));
assert.equal(auditLog.length, 1);
assert.equal(auditLog[0].event, "invoice-created");

await stopWorker();
await notifyAdapter.close();
await stateAdapter.close();
await sql.end();
