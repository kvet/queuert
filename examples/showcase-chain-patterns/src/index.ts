/**
 * Chain Patterns Showcase
 *
 * Demonstrates chain execution patterns through a subscription lifecycle.
 *
 * Scenarios:
 * 1. Linear: Jobs execute one after another
 * 2. Branched: Jobs conditionally continue to different types
 * 3. Loops: Jobs can continue to the same type
 * 4. Go-To: Jobs can jump to earlier or different types
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
   *   create-subscription
   *          |
   *          v
   *   activate-trial
   *          |
   *          v
   *   trial-decision -----> expire-trial (if not converted)
   *          |
   *          v (if converted)
   *   convert-to-paid
   *          |
   *          v
   *   charge-billing <---+
   *          |           |
   *          +--(loop)---+
   *          |
   *          v (after max cycles)
   *   cancel-subscription
   */
  "create-subscription": {
    entry: true;
    input: { userId: string; planId: string };
    continueWith: { typeName: "activate-trial" };
  };
  "activate-trial": {
    input: { subscriptionId: number; trialDays: number };
    continueWith: { typeName: "trial-decision" };
  };
  "trial-decision": {
    input: { subscriptionId: number };
    continueWith: { typeName: "convert-to-paid" | "expire-trial" };
  };
  "expire-trial": {
    input: { subscriptionId: number };
    output: { expiredAt: string };
  };
  "convert-to-paid": {
    input: { subscriptionId: number };
    continueWith: { typeName: "charge-billing" };
  };
  "charge-billing": {
    input: { subscriptionId: number; cycle: number };
    output: { finalCycle: number; totalCharged: number };
    continueWith: { typeName: "charge-billing" | "cancel-subscription" };
  };
  "cancel-subscription": {
    input: { subscriptionId: number; reason: string };
    output: { cancelledAt: string };
  };
}>();

const TRIAL_DAYS = 7;
const PRICE_PER_CYCLE = 9.99;
const MAX_BILLING_CYCLES = 3;

// Simulation state
let userConverts = true;

await using pg = await acquirePostgres("postgres:18", import.meta.url);
const sql = postgres(pg.connectionString, { max: 10 });

const stateProvider = createPostgresJsStateProvider({ sql });
const stateAdapter = await createPgStateAdapter({ stateProvider });
await stateAdapter.migrateToLatest();
const notifyProvider = createPostgresJsNotifyProvider({ sql });
const notifyAdapter = await createPgNotifyAdapter({ notifyProvider });

// Create schema
await sql`
  CREATE TABLE IF NOT EXISTS subscriptions (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    plan_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    trial_ends_at TIMESTAMP,
    current_cycle INTEGER DEFAULT 0,
    total_charged NUMERIC(10, 2) DEFAULT 0,
    cancelled_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
  )
`;

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
      "create-subscription": {
        attemptHandler: async ({ job, complete }) => {
          console.log(`\n[create-subscription] Creating subscription for user ${job.input.userId}`);

          return complete(async ({ sql, continueWith }) => {
            const [sub] = (await sql.unsafe(
              "INSERT INTO subscriptions (user_id, plan_id, status) VALUES ($1, $2, 'pending') RETURNING id",
              [job.input.userId, job.input.planId],
            )) as { id: number }[];
            console.log(`  Created subscription #${sub.id}`);

            return continueWith({
              typeName: "activate-trial",
              input: { subscriptionId: sub.id, trialDays: TRIAL_DAYS },
            });
          });
        },
      },

      "activate-trial": {
        attemptHandler: async ({ job, complete }) => {
          console.log(`\n[activate-trial] Activating ${job.input.trialDays}-day trial`);

          return complete(async ({ sql, continueWith }) => {
            const trialEndsAt = new Date(Date.now() + job.input.trialDays * 24 * 60 * 60 * 1000);
            await sql.unsafe(
              "UPDATE subscriptions SET status = 'trial', trial_ends_at = $1 WHERE id = $2",
              [trialEndsAt.toISOString(), job.input.subscriptionId],
            );
            console.log(`  Trial activated until ${trialEndsAt.toISOString()}`);

            return continueWith({
              typeName: "trial-decision",
              input: { subscriptionId: job.input.subscriptionId },
            });
          });
        },
      },

      "trial-decision": {
        attemptHandler: async ({ job, complete }) => {
          console.log(
            `\n[trial-decision] Evaluating trial for subscription #${job.input.subscriptionId}`,
          );

          const shouldConvert = userConverts;
          console.log(`  User decision: ${shouldConvert ? "CONVERT to paid" : "LET EXPIRE"}`);

          return complete(async ({ continueWith }) => {
            if (shouldConvert) {
              return continueWith({
                typeName: "convert-to-paid",
                input: { subscriptionId: job.input.subscriptionId },
              });
            } else {
              return continueWith({
                typeName: "expire-trial",
                input: { subscriptionId: job.input.subscriptionId },
              });
            }
          });
        },
      },

      "expire-trial": {
        attemptHandler: async ({ job, complete }) => {
          console.log(
            `\n[expire-trial] Trial expired for subscription #${job.input.subscriptionId}`,
          );

          return complete(async ({ sql }) => {
            await sql.unsafe("UPDATE subscriptions SET status = 'expired' WHERE id = $1", [
              job.input.subscriptionId,
            ]);
            const expiredAt = new Date().toISOString();
            console.log(`  Subscription expired at ${expiredAt}`);

            return { expiredAt };
          });
        },
      },

      "convert-to-paid": {
        attemptHandler: async ({ job, complete }) => {
          console.log(
            `\n[convert-to-paid] Converting subscription #${job.input.subscriptionId} to paid`,
          );

          return complete(async ({ sql, continueWith }) => {
            await sql.unsafe("UPDATE subscriptions SET status = 'active' WHERE id = $1", [
              job.input.subscriptionId,
            ]);
            console.log(`  Subscription is now active!`);

            return continueWith({
              typeName: "charge-billing",
              input: { subscriptionId: job.input.subscriptionId, cycle: 1 },
            });
          });
        },
      },

      "charge-billing": {
        attemptHandler: async ({ job, complete }) => {
          console.log(`\n[charge-billing] Processing cycle ${job.input.cycle}`);

          await new Promise((r) => setTimeout(r, 100));
          console.log(`  Charged $${PRICE_PER_CYCLE} for cycle ${job.input.cycle}`);

          return complete(async ({ sql, continueWith }) => {
            const [sub] = (await sql.unsafe(
              "UPDATE subscriptions SET current_cycle = $1, total_charged = total_charged + $2 WHERE id = $3 RETURNING total_charged",
              [job.input.cycle, PRICE_PER_CYCLE, job.input.subscriptionId],
            )) as { total_charged: string }[];

            const totalCharged = Number(sub.total_charged);
            console.log(`  Total charged so far: $${totalCharged.toFixed(2)}`);

            if (job.input.cycle < MAX_BILLING_CYCLES) {
              console.log(`  Scheduling next billing cycle...`);
              return continueWith({
                typeName: "charge-billing",
                input: { subscriptionId: job.input.subscriptionId, cycle: job.input.cycle + 1 },
              });
            } else {
              console.log(`  Max cycles reached, cancelling subscription...`);
              return continueWith({
                typeName: "cancel-subscription",
                input: {
                  subscriptionId: job.input.subscriptionId,
                  reason: "max_billing_cycles_reached",
                },
              });
            }
          });
        },
      },

      "cancel-subscription": {
        attemptHandler: async ({ job, complete }) => {
          console.log(
            `\n[cancel-subscription] Cancelling subscription #${job.input.subscriptionId}`,
          );
          console.log(`  Reason: ${job.input.reason}`);

          return complete(async ({ sql }) => {
            const cancelledAt = new Date().toISOString();
            await sql.unsafe(
              "UPDATE subscriptions SET status = 'cancelled', cancelled_at = $1 WHERE id = $2",
              [cancelledAt, job.input.subscriptionId],
            );
            console.log(`  Subscription cancelled at ${cancelledAt}`);

            return { cancelledAt };
          });
        },
      },
    },
  }),
});

const stopWorker = await worker.start();

// Scenario 1: User converts and goes through billing cycles
console.log("\n--- Scenario 1: User Converts Trial to Paid ---");
console.log("Linear -> Branched (convert) -> Loop (billing) -> Go-To (cancel)\n");

userConverts = true;

const chain1 = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (txSql) =>
    client.startChain({
      sql: txSql,
      transactionHooks,
      typeName: "create-subscription",
      input: { userId: "user-123", planId: "pro-monthly" },
    }),
  ),
);

const result1 = await client.awaitChain(chain1, { timeoutMs: 10000 });

const [sub1] = (await sql.unsafe(
  "SELECT status, current_cycle, total_charged FROM subscriptions WHERE id = 1",
)) as { status: string; current_cycle: number; total_charged: string }[];

console.log("\n" + "-".repeat(40));
console.log("SCENARIO 1 COMPLETED");
console.log("-".repeat(40));
console.log(`Final status: ${sub1.status}`);
console.log(`Billing cycles completed: ${sub1.current_cycle}`);
console.log(`Total charged: $${Number(sub1.total_charged).toFixed(2)}`);
console.log(
  `Cancelled at: ${"cancelledAt" in result1.output ? result1.output.cancelledAt : "N/A"}`,
);
assert.equal(sub1.status, "cancelled");
assert.equal(sub1.current_cycle, MAX_BILLING_CYCLES);
assert.equal(Number(sub1.total_charged), PRICE_PER_CYCLE * MAX_BILLING_CYCLES);
assert.ok("cancelledAt" in result1.output);

// Scenario 2: User lets trial expire
console.log("\n--- Scenario 2: User Lets Trial Expire ---");
console.log("Linear -> Branched (expire) -> Terminal\n");

userConverts = false;

const chain2 = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (txSql) =>
    client.startChain({
      sql: txSql,
      transactionHooks,
      typeName: "create-subscription",
      input: { userId: "user-456", planId: "pro-monthly" },
    }),
  ),
);

const result2 = await client.awaitChain(chain2, { timeoutMs: 10000 });

const [sub2] = (await sql.unsafe(
  "SELECT status, current_cycle, total_charged FROM subscriptions WHERE id = 2",
)) as { status: string; current_cycle: number; total_charged: string }[];

console.log("\n" + "-".repeat(40));
console.log("SCENARIO 2 COMPLETED");
console.log("-".repeat(40));
console.log(`Final status: ${sub2.status}`);
console.log(`Billing cycles completed: ${sub2.current_cycle}`);
console.log(`Total charged: $${Number(sub2.total_charged).toFixed(2)}`);
console.log(`Expired at: ${"expiredAt" in result2.output ? result2.output.expiredAt : "N/A"}`);
assert.equal(sub2.status, "expired");
assert.equal(sub2.current_cycle, 0);
assert.equal(Number(sub2.total_charged), 0);
assert.ok("expiredAt" in result2.output);

await stopWorker();
await notifyAdapter.close();
await stateAdapter.close();
await sql.end();
