/**
 * Chain Patterns Showcase
 *
 * Demonstrates job chain execution patterns through a subscription lifecycle.
 *
 * Scenarios:
 * 1. Linear: Jobs execute one after another
 * 2. Branched: Jobs conditionally continue to different types
 * 3. Loops: Jobs can continue to the same type
 * 4. Go-To: Jobs can jump to earlier or different types
 */

import { type PgStateProvider, createPgStateAdapter } from "@queuert/postgres";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, {
  type PendingQuery,
  type Row,
  type TransactionSql as _TransactionSql,
} from "postgres";
import { createQueuertClient, createQueuertInProcessWorker, defineJobTypes } from "queuert";
import { createInProcessNotifyAdapter } from "queuert/internal";

type TransactionSql = _TransactionSql & {
  <T extends readonly (object | undefined)[] = Row[]>(
    template: TemplateStringsArray,
    ...parameters: readonly postgres.ParameterOrFragment<never>[]
  ): PendingQuery<T>;
};

type DbContext = { sql: TransactionSql };

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

const pgContainer = await new PostgreSqlContainer("postgres:14").withExposedPorts(5432).start();
const sql = postgres(pgContainer.getConnectionUri(), { max: 10 });

const stateProvider: PgStateProvider<DbContext> = {
  runInTransaction: async (cb) => {
    let result: any;
    await sql.begin(async (txSql) => {
      result = await cb({ sql: txSql as TransactionSql });
    });
    return result;
  },
  executeSql: async ({ txContext, sql: query, params }) => {
    const client = txContext?.sql ?? sql;
    return client.unsafe(
      query,
      (params ?? []).map((p) => (p === undefined ? null : p)) as (
        | string
        | number
        | boolean
        | null
      )[],
    );
  },
};

const stateAdapter = await createPgStateAdapter({ stateProvider, schema: "public" });
await stateAdapter.migrateToLatest();
const notifyAdapter = createInProcessNotifyAdapter();

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

const client = await createQueuertClient({
  stateAdapter,
  notifyAdapter,
  registry: jobTypes,
  log: () => {},
});

const worker = await createQueuertInProcessWorker({
  stateAdapter,
  notifyAdapter,
  registry: jobTypes,
  log: () => {},
  processors: {
    "create-subscription": {
      attemptHandler: async ({ job, complete }) => {
        console.log(`\n[create-subscription] Creating subscription for user ${job.input.userId}`);

        return complete(async ({ sql: txSql, continueWith }) => {
          const [sub] = await txSql<{ id: number }[]>`
            INSERT INTO subscriptions (user_id, plan_id, status)
            VALUES (${job.input.userId}, ${job.input.planId}, 'pending')
            RETURNING id
          `;
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

        return complete(async ({ sql: txSql, continueWith }) => {
          const trialEndsAt = new Date(Date.now() + job.input.trialDays * 24 * 60 * 60 * 1000);
          await txSql`
            UPDATE subscriptions
            SET status = 'trial', trial_ends_at = ${trialEndsAt.toISOString()}
            WHERE id = ${job.input.subscriptionId}
          `;
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
        console.log(`\n[expire-trial] Trial expired for subscription #${job.input.subscriptionId}`);

        return complete(async ({ sql: txSql }) => {
          await txSql`
            UPDATE subscriptions
            SET status = 'expired'
            WHERE id = ${job.input.subscriptionId}
          `;
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

        return complete(async ({ sql: txSql, continueWith }) => {
          await txSql`
            UPDATE subscriptions
            SET status = 'active'
            WHERE id = ${job.input.subscriptionId}
          `;
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
        console.log(`\n[cancel-subscription] Cancelling subscription #${job.input.subscriptionId}`);
        console.log(`  Reason: ${job.input.reason}`);

        return complete(async ({ sql: txSql }) => {
          const cancelledAt = new Date().toISOString();
          await txSql`
            UPDATE subscriptions
            SET status = 'cancelled', cancelled_at = ${cancelledAt}
            WHERE id = ${job.input.subscriptionId}
          `;
          console.log(`  Subscription cancelled at ${cancelledAt}`);

          return { cancelledAt };
        });
      },
    },
  },
});

const stopWorker = await worker.start();

// Scenario 1: User converts and goes through billing cycles
console.log("\n--- Scenario 1: User Converts Trial to Paid ---");
console.log("Linear -> Branched (convert) -> Loop (billing) -> Go-To (cancel)\n");

userConverts = true;

const chain1 = await client.withNotify(async () =>
  sql.begin(async (_sql) => {
    const txSql = _sql as TransactionSql;
    return client.startJobChain({
      sql: txSql,
      typeName: "create-subscription",
      input: { userId: "user-123", planId: "pro-monthly" },
    });
  }),
);

const result1 = await client.waitForJobChainCompletion(chain1, { timeoutMs: 10000 });

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

// Scenario 2: User lets trial expire
console.log("\n--- Scenario 2: User Lets Trial Expire ---");
console.log("Linear -> Branched (expire) -> Terminal\n");

userConverts = false;

const chain2 = await client.withNotify(async () =>
  sql.begin(async (_sql) => {
    const txSql = _sql as TransactionSql;
    return client.startJobChain({
      sql: txSql,
      typeName: "create-subscription",
      input: { userId: "user-456", planId: "pro-monthly" },
    });
  }),
);

const result2 = await client.waitForJobChainCompletion(chain2, { timeoutMs: 10000 });

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
await sql.end();
await pgContainer.stop();
