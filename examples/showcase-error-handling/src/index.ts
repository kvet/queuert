/**
 * Error Handling Showcase
 *
 * Demonstrates error handling patterns in Queuert job chains.
 *
 * Scenarios:
 * 1. Discriminated Unions: Success/failure represented in typed outputs
 * 2. Compensation Pattern: Failed job continues to rollback/refund job
 * 3. Explicit Rescheduling: Rate-limited API calls with rescheduleJob
 */

import { type PgStateProvider, createPgStateAdapter } from "@queuert/postgres";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, {
  type PendingQuery,
  type Row,
  type TransactionSql as _TransactionSql,
} from "postgres";
import { createClient, createInProcessWorker, defineJobTypes, rescheduleJob } from "queuert";
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
   * Workflow (discriminated union):
   *   process-payment --> output { success } | { error }
   */
  "process-payment": {
    entry: true;
    input: { orderId: string; amount: number };
    output: { success: true; transactionId: string } | { success: false; error: string };
  };

  /*
   * Workflow (compensation):
   *   charge-card
   *        |
   *        v
   *   ship-order ---> output { shipped } (success)
   *        |
   *        v (failure)
   *   refund-charge --> output { refunded }
   */
  "charge-card": {
    entry: true;
    input: { orderId: string; amount: number };
    continueWith: { typeName: "ship-order" | "refund-charge" };
  };
  "ship-order": {
    input: { orderId: string; chargeId: string };
    output: { shipped: true };
    continueWith: { typeName: "refund-charge" };
  };
  "refund-charge": {
    input: { chargeId: string; reason: string };
    output: { refunded: true; refundId: string };
  };

  /*
   * Workflow (rescheduling):
   *   call-rate-limited-api <--+ (reschedule on rate limit)
   *        |                   |
   *        +-------------------+
   *        |
   *        v (success)
   *   output { data }
   */
  "call-rate-limited-api": {
    entry: true;
    input: { endpoint: string };
    output: { data: string };
  };
}>();

// Simulation state
let shipmentShouldFail = false;
let apiRateLimited = true;

const pgContainer = await new PostgreSqlContainer("postgres:18").withExposedPorts(5432).start();
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

const client = await createClient({
  stateAdapter,
  notifyAdapter,
  registry: jobTypes,
});

const worker = await createInProcessWorker({
  stateAdapter,
  notifyAdapter,
  registry: jobTypes,
  processors: {
    "process-payment": {
      attemptHandler: async ({ job, complete }) => {
        console.log(
          `[process-payment] Processing $${job.input.amount} for order ${job.input.orderId}`,
        );

        if (job.input.amount > 1000) {
          console.log(`  Payment FAILED: Amount exceeds limit`);
          return complete(async () => ({ success: false, error: "Amount exceeds limit" }));
        }

        console.log(`  Payment SUCCESS`);
        return complete(async () => ({ success: true, transactionId: `txn_${Date.now()}` }));
      },
    },

    "charge-card": {
      attemptHandler: async ({ job, complete }) => {
        console.log(`[charge-card] Charging $${job.input.amount} for order ${job.input.orderId}`);
        const chargeId = `ch_${Date.now()}`;
        console.log(`  Charge successful: ${chargeId}`);

        return complete(async ({ continueWith }) =>
          continueWith({
            typeName: "ship-order",
            input: { orderId: job.input.orderId, chargeId },
          }),
        );
      },
    },

    "ship-order": {
      attemptHandler: async ({ job, complete }) => {
        console.log(`[ship-order] Shipping order ${job.input.orderId}`);

        if (shipmentShouldFail) {
          console.log(`  Shipping FAILED - continuing to refund`);
          return complete(async ({ continueWith }) =>
            continueWith({
              typeName: "refund-charge",
              input: { chargeId: job.input.chargeId, reason: "shipping_failed" },
            }),
          );
        }

        console.log(`  Shipping SUCCESS`);
        return complete(async () => ({ shipped: true }));
      },
    },

    "refund-charge": {
      attemptHandler: async ({ job, complete }) => {
        console.log(`[refund-charge] Refunding ${job.input.chargeId} (${job.input.reason})`);
        const refundId = `rf_${Date.now()}`;
        console.log(`  Refund successful: ${refundId}`);
        return complete(async () => ({ refunded: true, refundId }));
      },
    },

    "call-rate-limited-api": {
      attemptHandler: async ({ job, complete }) => {
        console.log(`[call-rate-limited-api] Attempt ${job.attempt} to ${job.input.endpoint}`);

        if (apiRateLimited && job.attempt < 3) {
          console.log(`  Rate limited! Rescheduling in 100ms...`);
          rescheduleJob({ afterMs: 100 });
        }

        console.log(`  API call SUCCESS`);
        return complete(async () => ({ data: `Response from ${job.input.endpoint}` }));
      },
    },
  },
});

const stopWorker = await worker.start();

// Scenario 1: Discriminated union outputs
console.log("\n--- Scenario 1: Discriminated Union Outputs ---");
console.log("Payment results are typed as success | failure.\n");

const payment1 = await client.withNotify(async () =>
  sql.begin(async (_sql) => {
    const txSql = _sql as TransactionSql;
    return client.startJobChain({
      sql: txSql,
      typeName: "process-payment",
      input: { orderId: "order-1", amount: 500 },
    });
  }),
);
const result1 = await client.waitForJobChainCompletion(payment1, { timeoutMs: 5000 });
console.log(
  `Result: ${result1.output.success ? `SUCCESS (${result1.output.transactionId})` : `FAILED (${result1.output.error})`}`,
);

const payment2 = await client.withNotify(async () =>
  sql.begin(async (_sql) => {
    const txSql = _sql as TransactionSql;
    return client.startJobChain({
      sql: txSql,
      typeName: "process-payment",
      input: { orderId: "order-2", amount: 1500 },
    });
  }),
);
const result2 = await client.waitForJobChainCompletion(payment2, { timeoutMs: 5000 });
console.log(
  `Result: ${result2.output.success ? `SUCCESS (${result2.output.transactionId})` : `FAILED (${result2.output.error})`}`,
);

// Scenario 2: Compensation pattern - success path
console.log("\n--- Scenario 2a: Compensation Pattern (Success) ---");
console.log("Charge -> Ship succeeds.\n");

shipmentShouldFail = false;
const order1 = await client.withNotify(async () =>
  sql.begin(async (_sql) => {
    const txSql = _sql as TransactionSql;
    return client.startJobChain({
      sql: txSql,
      typeName: "charge-card",
      input: { orderId: "order-3", amount: 100 },
    });
  }),
);
const orderResult1 = await client.waitForJobChainCompletion(order1, { timeoutMs: 5000 });
console.log(`Final output: ${JSON.stringify(orderResult1.output)}`);

// Scenario 2: Compensation pattern - failure path
console.log("\n--- Scenario 2b: Compensation Pattern (Failure -> Refund) ---");
console.log("Charge -> Ship fails -> Refund.\n");

shipmentShouldFail = true;
const order2 = await client.withNotify(async () =>
  sql.begin(async (_sql) => {
    const txSql = _sql as TransactionSql;
    return client.startJobChain({
      sql: txSql,
      typeName: "charge-card",
      input: { orderId: "order-4", amount: 100 },
    });
  }),
);
const orderResult2 = await client.waitForJobChainCompletion(order2, { timeoutMs: 5000 });
console.log(`Final output: ${JSON.stringify(orderResult2.output)}`);

// Scenario 3: Explicit rescheduling
console.log("\n--- Scenario 3: Explicit Rescheduling ---");
console.log("API is rate-limited, job reschedules itself.\n");

apiRateLimited = true;
const apiCall = await client.withNotify(async () =>
  sql.begin(async (_sql) => {
    const txSql = _sql as TransactionSql;
    return client.startJobChain({
      sql: txSql,
      typeName: "call-rate-limited-api",
      input: { endpoint: "/api/data" },
    });
  }),
);
const apiResult = await client.waitForJobChainCompletion(apiCall, { timeoutMs: 5000 });
console.log(`Final output: ${JSON.stringify(apiResult.output)}`);

await stopWorker();
await sql.end();
await pgContainer.stop();
