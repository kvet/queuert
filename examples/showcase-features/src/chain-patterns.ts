/**
 * Chain Patterns Showcase
 *
 * Demonstrates job chain execution patterns through a subscription lifecycle:
 *
 * 1. LINEAR: create-subscription -> activate-trial
 *    Jobs execute one after another
 *
 * 2. BRANCHED: trial-decision -> convert-to-paid | expire-trial
 *    Jobs conditionally continue to different types
 *
 * 3. LOOPS: charge-billing -> (loops back to charge-billing for renewals)
 *    Jobs can continue to the same type
 *
 * 4. GO-TO: cancel-subscription can be reached from multiple points
 *    Jobs can jump to earlier or different types
 *
 * Workflow:
 *   create-subscription
 *         |
 *         v
 *   activate-trial
 *         |
 *         v
 *   trial-decision -----> expire-trial (if trial not converted)
 *         |
 *         v (if converted)
 *   convert-to-paid
 *         |
 *         v
 *   charge-billing <--+
 *         |           |
 *         +-----------+ (loop: renew subscription)
 *         |
 *         v (when cancelled or max cycles)
 *   cancel-subscription
 */

import { createQueuertClient, createQueuertInProcessWorker, defineJobTypes } from "queuert";
import { SetupContext } from "./setup.js";

// ============================================================================
// Job Types
// ============================================================================

const jobTypes = defineJobTypes<{
  // Entry point - creates a new subscription
  "create-subscription": {
    entry: true;
    input: { userId: string; planId: string };
    continueWith: { typeName: "activate-trial" };
  };

  // LINEAR: Follows create-subscription
  "activate-trial": {
    input: { subscriptionId: number; trialDays: number };
    continueWith: { typeName: "trial-decision" };
  };

  // BRANCHED: Decides whether to convert or expire
  "trial-decision": {
    input: { subscriptionId: number };
    continueWith: { typeName: "convert-to-paid" | "expire-trial" };
  };

  // Branch: Trial expired
  "expire-trial": {
    input: { subscriptionId: number };
    output: { expiredAt: string };
  };

  // Branch: Convert to paid
  "convert-to-paid": {
    input: { subscriptionId: number };
    continueWith: { typeName: "charge-billing" };
  };

  // LOOPS: Can continue to itself for renewals
  "charge-billing": {
    input: { subscriptionId: number; cycle: number };
    output: { finalCycle: number; totalCharged: number };
    continueWith: { typeName: "charge-billing" | "cancel-subscription" };
  };

  // GO-TO target: Can be reached from billing loop
  "cancel-subscription": {
    input: { subscriptionId: number; reason: string };
    output: { cancelledAt: string };
  };
}>();

// ============================================================================
// Configuration
// ============================================================================

const TRIAL_DAYS = 7;
const PRICE_PER_CYCLE = 9.99;
const MAX_BILLING_CYCLES = 3; // For demo purposes, limit to 3 cycles

// ============================================================================
// Main Function
// ============================================================================

export async function runChainPatternsShowcase(setup: SetupContext): Promise<void> {
  const { sql, stateAdapter, notifyAdapter, log } = setup;

  console.log("\n" + "=".repeat(60));
  console.log("CHAIN PATTERNS SHOWCASE: Subscription Lifecycle");
  console.log("=".repeat(60));

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

  // Simulation state: whether user converts trial
  let userConverts = true;

  // Create client
  const client = await createQueuertClient({
    stateAdapter,
    notifyAdapter,
    log,
    jobTypeRegistry: jobTypes,
  });

  // Create worker
  const worker = await createQueuertInProcessWorker({
    stateAdapter,
    notifyAdapter,
    log,
    jobTypeRegistry: jobTypes,
    jobTypeProcessors: {
      // =========================================================================
      // CREATE SUBSCRIPTION (Entry Point)
      // =========================================================================
      "create-subscription": {
        process: async ({ job, complete }) => {
          console.log(`\n[create-subscription] Creating subscription for user ${job.input.userId}`);

          return complete(async ({ sql: txSql, continueWith }) => {
            const [sub] = await txSql<{ id: number }[]>`
              INSERT INTO subscriptions (user_id, plan_id, status)
              VALUES (${job.input.userId}, ${job.input.planId}, 'pending')
              RETURNING id
            `;
            console.log(`  Created subscription #${sub.id}`);

            // LINEAR: Continue to activate-trial
            return continueWith({
              typeName: "activate-trial",
              input: { subscriptionId: sub.id, trialDays: TRIAL_DAYS },
            });
          });
        },
      },

      // =========================================================================
      // ACTIVATE TRIAL (Linear continuation)
      // =========================================================================
      "activate-trial": {
        process: async ({ job, complete }) => {
          console.log(`\n[activate-trial] Activating ${job.input.trialDays}-day trial`);

          return complete(async ({ sql: txSql, continueWith }) => {
            const trialEndsAt = new Date(Date.now() + job.input.trialDays * 24 * 60 * 60 * 1000);
            await txSql`
              UPDATE subscriptions
              SET status = 'trial', trial_ends_at = ${trialEndsAt.toISOString()}
              WHERE id = ${job.input.subscriptionId}
            `;
            console.log(`  Trial activated until ${trialEndsAt.toISOString()}`);

            // LINEAR: Continue to trial-decision
            return continueWith({
              typeName: "trial-decision",
              input: { subscriptionId: job.input.subscriptionId },
            });
          });
        },
      },

      // =========================================================================
      // TRIAL DECISION (Branched - decides convert or expire)
      // =========================================================================
      "trial-decision": {
        process: async ({ job, complete }) => {
          console.log(
            `\n[trial-decision] Evaluating trial for subscription #${job.input.subscriptionId}`,
          );

          // Simulate checking if user wants to convert
          // In real app, this could check payment method on file, user activity, etc.
          const shouldConvert = userConverts;
          console.log(`  User decision: ${shouldConvert ? "CONVERT to paid" : "LET EXPIRE"}`);

          return complete(async ({ continueWith }) => {
            // BRANCHED: Choose different paths based on condition
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

      // =========================================================================
      // EXPIRE TRIAL (Branch: terminal state for non-converted users)
      // =========================================================================
      "expire-trial": {
        process: async ({ job, complete }) => {
          console.log(
            `\n[expire-trial] Trial expired for subscription #${job.input.subscriptionId}`,
          );

          return complete(async ({ sql: txSql }) => {
            await txSql`
              UPDATE subscriptions
              SET status = 'expired'
              WHERE id = ${job.input.subscriptionId}
            `;
            const expiredAt = new Date().toISOString();
            console.log(`  Subscription expired at ${expiredAt}`);

            // Terminal state - no continueWith
            return { expiredAt };
          });
        },
      },

      // =========================================================================
      // CONVERT TO PAID (Branch: continue to billing loop)
      // =========================================================================
      "convert-to-paid": {
        process: async ({ job, complete }) => {
          console.log(
            `\n[convert-to-paid] Converting subscription #${job.input.subscriptionId} to paid`,
          );

          return complete(async ({ sql: txSql, continueWith }) => {
            await txSql`
              UPDATE subscriptions
              SET status = 'active'
              WHERE id = ${job.input.subscriptionId}
            `;
            console.log(`  Subscription is now active!`);

            // Continue to billing loop
            return continueWith({
              typeName: "charge-billing",
              input: { subscriptionId: job.input.subscriptionId, cycle: 1 },
            });
          });
        },
      },

      // =========================================================================
      // CHARGE BILLING (Loops - continues to itself for renewals)
      // =========================================================================
      "charge-billing": {
        process: async ({ job, complete }) => {
          console.log(`\n[charge-billing] Processing cycle ${job.input.cycle}`);

          // Simulate payment processing
          await new Promise((r) => setTimeout(r, 100));
          console.log(`  Charged $${PRICE_PER_CYCLE} for cycle ${job.input.cycle}`);

          return complete(async ({ sql: txSql, continueWith }) => {
            const [sub] = await txSql<{ total_charged: string }[]>`
              UPDATE subscriptions
              SET current_cycle = ${job.input.cycle},
                  total_charged = total_charged + ${PRICE_PER_CYCLE}
              WHERE id = ${job.input.subscriptionId}
              RETURNING total_charged
            `;

            const totalCharged = Number(sub.total_charged);
            console.log(`  Total charged so far: $${totalCharged.toFixed(2)}`);

            // LOOP: Continue to same type for next cycle, or GO-TO cancel
            if (job.input.cycle < MAX_BILLING_CYCLES) {
              console.log(`  Scheduling next billing cycle...`);
              return continueWith({
                typeName: "charge-billing",
                input: { subscriptionId: job.input.subscriptionId, cycle: job.input.cycle + 1 },
              });
            } else {
              console.log(`  Max cycles reached, cancelling subscription...`);
              // GO-TO: Jump to cancel-subscription
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

      // =========================================================================
      // CANCEL SUBSCRIPTION (Go-to target - can be reached from multiple points)
      // =========================================================================
      "cancel-subscription": {
        process: async ({ job, complete }) => {
          console.log(
            `\n[cancel-subscription] Cancelling subscription #${job.input.subscriptionId}`,
          );
          console.log(`  Reason: ${job.input.reason}`);

          return complete(async ({ sql: txSql }) => {
            const cancelledAt = new Date().toISOString();
            await txSql`
              UPDATE subscriptions
              SET status = 'cancelled', cancelled_at = ${cancelledAt}
              WHERE id = ${job.input.subscriptionId}
            `;
            console.log(`  Subscription cancelled at ${cancelledAt}`);

            // Terminal state
            return { cancelledAt };
          });
        },
      },
    },
  });

  // Run the workflow
  const stopWorker = await worker.start();

  // =========================================================================
  // Scenario 1: User converts and goes through billing cycles
  // =========================================================================
  console.log("\n" + "-".repeat(40));
  console.log("SCENARIO 1: User converts trial to paid");
  console.log("-".repeat(40));

  userConverts = true;

  const chain1 = await client.withNotify(async () =>
    setup.stateProvider.runInTransaction(async (txContext) =>
      client.startJobChain({
        ...txContext,
        typeName: "create-subscription",
        input: { userId: "user-123", planId: "pro-monthly" },
      }),
    ),
  );

  const result1 = await client.waitForJobChainCompletion(chain1, { timeoutMs: 10000 });

  // Query final state
  const [sub1] = await sql<
    {
      status: string;
      current_cycle: number;
      total_charged: string;
    }[]
  >`SELECT status, current_cycle, total_charged FROM subscriptions WHERE id = 1`;

  console.log("\n" + "-".repeat(40));
  console.log("SCENARIO 1 COMPLETED");
  console.log("-".repeat(40));
  console.log(`Final status: ${sub1.status}`);
  console.log(`Billing cycles completed: ${sub1.current_cycle}`);
  console.log(`Total charged: $${Number(sub1.total_charged).toFixed(2)}`);
  console.log(
    `Cancelled at: ${"cancelledAt" in result1.output ? result1.output.cancelledAt : "N/A"}`,
  );

  // =========================================================================
  // Scenario 2: User lets trial expire
  // =========================================================================
  console.log("\n" + "-".repeat(40));
  console.log("SCENARIO 2: User lets trial expire");
  console.log("-".repeat(40));

  userConverts = false;

  const chain2 = await client.withNotify(async () =>
    setup.stateProvider.runInTransaction(async (txContext) =>
      client.startJobChain({
        ...txContext,
        typeName: "create-subscription",
        input: { userId: "user-456", planId: "pro-monthly" },
      }),
    ),
  );

  const result2 = await client.waitForJobChainCompletion(chain2, { timeoutMs: 10000 });

  // Query final state
  const [sub2] = await sql<
    {
      status: string;
      current_cycle: number;
      total_charged: string;
    }[]
  >`SELECT status, current_cycle, total_charged FROM subscriptions WHERE id = 2`;

  console.log("\n" + "-".repeat(40));
  console.log("SCENARIO 2 COMPLETED");
  console.log("-".repeat(40));
  console.log(`Final status: ${sub2.status}`);
  console.log(`Billing cycles completed: ${sub2.current_cycle}`);
  console.log(`Total charged: $${Number(sub2.total_charged).toFixed(2)}`);
  console.log(`Expired at: ${"expiredAt" in result2.output ? result2.output.expiredAt : "N/A"}`);

  await stopWorker();
}
