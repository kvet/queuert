/**
 * Job & Chain Queries Showcase
 *
 * Demonstrates read-only query methods for inspecting job chains and jobs.
 *
 * Scenarios:
 * 1. Single Lookups: Get a chain or job by ID with type narrowing
 * 2. Paginated Lists: Filter and paginate chains and jobs
 * 3. Chain Jobs: List jobs within a chain ordered by chain index
 * 4. Blocker Queries: Inspect blocker relationships from both directions
 */

import assert from "node:assert/strict";

import { createPgNotifyAdapter, createPgStateAdapter } from "@queuert/postgres";
import { acquirePostgres } from "@queuert/testcontainers";
import { createPostgresJsNotifyProvider } from "example-notify-postgres-postgres-js/provider";
import { createPostgresJsStateProvider } from "example-state-postgres-postgres-js/provider";
import postgres from "postgres";
import {
  createClient,
  createInProcessWorker,
  createProcessors,
  defineJobTypes,
  withTransactionHooks,
} from "queuert";

const jobTypes = defineJobTypes<{
  /*
   * Workflow:
   *   validate-input --+
   *                    +--> process-order --> ship-order
   *   check-stock -----+
   */
  "validate-input": {
    entry: true;
    input: { orderId: string; items: string[] };
    output: { valid: true };
  };
  "check-stock": {
    entry: true;
    input: { orderId: string; items: string[] };
    output: { available: true };
  };
  "process-order": {
    entry: true;
    input: { orderId: string };
    output: { orderId: string; total: number };
    blockers: [{ typeName: "validate-input" }, { typeName: "check-stock" }];
    continueWith: { typeName: "ship-order" };
  };
  "ship-order": {
    input: { orderId: string; total: number };
    output: { trackingId: string };
  };

  "send-notification": {
    entry: true;
    input: { userId: string; message: string };
    output: { sentAt: string };
  };
}>();

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
    processors: {
      "validate-input": {
        attemptHandler: async ({ job, complete }) => {
          console.log(`[validate-input] Validating order ${job.input.orderId}`);
          return complete(async () => ({ valid: true }));
        },
      },

      "check-stock": {
        attemptHandler: async ({ job, complete }) => {
          console.log(`[check-stock] Checking stock for order ${job.input.orderId}`);
          return complete(async () => ({ available: true }));
        },
      },

      "process-order": {
        attemptHandler: async ({ job, complete }) => {
          console.log(`[process-order] Processing order ${job.input.orderId}`);
          return complete(async ({ continueWith }) =>
            continueWith({
              typeName: "ship-order",
              input: { orderId: job.input.orderId, total: 99.99 },
            }),
          );
        },
      },

      "ship-order": {
        attemptHandler: async ({ job, complete }) => {
          console.log(`[ship-order] Shipping order ${job.input.orderId}`);
          return complete(async () => ({ trackingId: `TRACK-${job.input.orderId}` }));
        },
      },

      "send-notification": {
        attemptHandler: async ({ job, complete }) => {
          console.log(`[send-notification] Sending to ${job.input.userId}`);
          return complete(async () => ({ sentAt: new Date().toISOString() }));
        },
      },
    },
  }),
});

const stopWorker = await worker.start();

// Create test data: an order workflow with blockers + some notifications
const [validateChain, _stockChain, orderChain] = await withTransactionHooks(
  async (transactionHooks) =>
    sql.begin(async (txSql) => {
      const [validate, stock] = await client.startJobChains({
        sql: txSql,
        transactionHooks,
        items: [
          {
            typeName: "validate-input",
            input: { orderId: "ORD-001", items: ["widget", "gadget"] },
          },
          { typeName: "check-stock", input: { orderId: "ORD-001", items: ["widget", "gadget"] } },
        ],
      });
      const order = await client.startJobChain({
        sql: txSql,
        transactionHooks,
        typeName: "process-order",
        input: { orderId: "ORD-001" },
        blockers: [validate, stock],
      });
      return [validate, stock, order] as const;
    }),
);

const notifyChains = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (txSql) =>
    client.startJobChains({
      sql: txSql,
      transactionHooks,
      items: [
        { typeName: "send-notification", input: { userId: "alice", message: "Order placed" } },
        { typeName: "send-notification", input: { userId: "bob", message: "Welcome aboard" } },
      ],
    }),
  ),
);

await Promise.all([
  client.awaitJobChain(orderChain, { timeoutMs: 10000 }),
  ...notifyChains.map(async (c) => client.awaitJobChain(c, { timeoutMs: 10000 })),
]);

// Scenario 1: Single lookups with type narrowing
console.log("\n--- Scenario 1: Single Lookups ---\n");

const jobChain = await client.getJobChain({ id: orderChain.id, typeName: "process-order" });
if (jobChain) {
  console.log(`Chain: ${jobChain.typeName} (${jobChain.status})`);
  console.log(`  Input: ${JSON.stringify(jobChain.input)}`);
  if (jobChain.status === "completed") {
    console.log(`  Output: ${JSON.stringify(jobChain.output)}`);
  }
}

const job = await client.getJob({ id: orderChain.id, typeName: "process-order" });
if (job) {
  console.log(`Job: ${job.typeName} (${job.status})`);
  console.log(`  Chain index: ${job.chainIndex}`);
}

const missing = await client.getJobChain({ id: "00000000-0000-0000-0000-000000000000" as any });
console.log("Missing chain:", missing);
assert.equal(missing, undefined);

// Scenario 2: Paginated lists with filters
console.log("\n--- Scenario 2: Paginated Lists ---\n");

const completedChains = await client.listJobChains({
  filter: { status: ["completed"] },
  limit: 3,
});
console.log(`Completed chains (page 1, limit 3): ${completedChains.items.length} items`);
assert.ok(completedChains.items.length <= 3);
for (const c of completedChains.items) {
  console.log(`  "${c.typeName}" — ${c.status}`);
}

if (completedChains.nextCursor) {
  const page2 = await client.listJobChains({
    filter: { status: ["completed"] },
    cursor: completedChains.nextCursor,
    limit: 3,
  });
  console.log(`Completed chains (page 2): ${page2.items.length} items`);
  for (const c of page2.items) {
    console.log(`  "${c.typeName}" — ${c.status}`);
  }
}

const notifyJobs = await client.listJobs({
  filter: { typeName: ["send-notification"] },
});
console.log(`\nNotification jobs: ${notifyJobs.items.length}`);
for (const j of notifyJobs.items) {
  console.log(`  ${j.typeName} for ${j.input.userId} — ${j.status}`);
}
assert.equal(notifyJobs.items.length, 2);

// Scenario 3: List jobs within a chain
console.log("\n--- Scenario 3: Chain Jobs ---\n");

const chainJobs = await client.listJobChainJobs({
  jobChainId: orderChain.id,
  typeName: "process-order",
});
console.log(`Jobs in order chain (${orderChain.id}):`);
for (const j of chainJobs.items) {
  console.log(`  [${j.chainIndex}] ${j.typeName} — ${j.status}`);
}

// Scenario 4: Blocker relationships
console.log("\n--- Scenario 4: Blocker Queries ---\n");

const blockers = await client.getJobBlockers({
  jobId: orderChain.id,
  typeName: "process-order",
});
console.log(`Blockers for process-order:`);
for (const b of blockers) {
  console.log(`  "${b.typeName}" — ${b.status}`);
  if (b.status === "completed") {
    console.log(`    Output: ${JSON.stringify(b.output)}`);
  }
}
assert.equal(blockers.length, 2);

const blockedByValidate = await client.listBlockedJobs({
  jobChainId: validateChain.id,
  typeName: "validate-input",
});
console.log(`\nJobs blocked by validate-input chain:`);
for (const j of blockedByValidate.items) {
  console.log(`  "${j.typeName}" (${j.id}) — ${j.status}`);
}

await stopWorker();
await sql.end();
