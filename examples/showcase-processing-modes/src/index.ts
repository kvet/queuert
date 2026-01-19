/**
 * Processing Modes Showcase
 *
 * Demonstrates the three processing modes through an order fulfillment workflow:
 *
 * 1. ATOMIC MODE (reserve-inventory)
 *    - Prepare and complete run in ONE transaction
 *    - Use when multiple writes MUST succeed or fail together
 *
 * 2. STAGED MODE (charge-payment)
 *    - Prepare and complete run in SEPARATE transactions
 *    - Processing phase in between (with automatic lease renewal)
 *    - Use for external API calls or long-running operations
 *
 * 3. AUTO-SETUP (send-confirmation)
 *    - Just call complete() without prepare()
 *    - System determines mode based on when complete() is called
 */

import { createPgStateAdapter, PgStateProvider } from "@queuert/postgres";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { PendingQuery, Row, TransactionSql as _TransactionSql } from "postgres";
import {
  createConsoleLog,
  createQueuertClient,
  createQueuertInProcessWorker,
  defineJobTypes,
} from "queuert";
import { createInProcessNotifyAdapter } from "queuert/internal";

// ============================================================================
// 1. Start PostgreSQL
// ============================================================================

console.log("Starting PostgreSQL...");
const pgContainer = await new PostgreSqlContainer("postgres:14").withExposedPorts(5432).start();

// ============================================================================
// 2. Create database connection and schema
// ============================================================================

const sql = postgres(pgContainer.getConnectionUri(), { max: 10 });

await sql`
  CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    price NUMERIC(10, 2) NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0
  )
`;

await sql`
  CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    payment_id TEXT
  )
`;

await sql`INSERT INTO products (name, price, stock) VALUES ('Widget Pro', 99.99, 5)`;

// ============================================================================
// 3. Define job types
// ============================================================================

const jobTypes = defineJobTypes<{
  "reserve-inventory": {
    entry: true;
    input: { orderId: number };
    continueWith: { typeName: "charge-payment" };
  };
  "charge-payment": {
    input: { orderId: number; amount: number };
    continueWith: { typeName: "send-confirmation" };
  };
  "send-confirmation": {
    input: { orderId: number; paymentId: string };
    output: { confirmedAt: string };
  };
}>();

// ============================================================================
// 4. Create state provider (postgres.js boilerplate)
// ============================================================================

type TransactionSql = _TransactionSql & {
  <T extends readonly (object | undefined)[] = Row[]>(
    template: TemplateStringsArray,
    ...parameters: readonly postgres.ParameterOrFragment<never>[]
  ): PendingQuery<T>;
};

type DbContext = { sql: TransactionSql };

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
    const normalizedParams = (params ?? []) as (string | number | boolean | null)[];
    return client.unsafe(
      query,
      normalizedParams.map((p) => (p === undefined ? null : p)),
    );
  },
};

// ============================================================================
// 5. Create adapters
// ============================================================================

const stateAdapter = await createPgStateAdapter({ stateProvider, schema: "public" });
await stateAdapter.migrateToLatest();

const notifyAdapter = createInProcessNotifyAdapter();
const log = createConsoleLog();

// ============================================================================
// 6. Create client and worker
// ============================================================================

const client = await createQueuertClient({
  stateAdapter,
  notifyAdapter,
  log,
  jobTypeRegistry: jobTypes,
});

// Simulated external payment API
async function chargePaymentAPI(amount: number): Promise<{ paymentId: string }> {
  console.log(`  [Payment API] Processing $${amount}...`);
  await new Promise((r) => setTimeout(r, 500)); // Simulate latency
  return { paymentId: `pay_${Date.now()}` };
}

const worker = await createQueuertInProcessWorker({
  stateAdapter,
  notifyAdapter,
  log,
  jobTypeRegistry: jobTypes,
  jobTypeProcessors: {
    // =========================================================================
    // ATOMIC MODE: Reserve inventory
    // =========================================================================
    // Why atomic? We read stock, check availability, then decrement.
    // Both the read and write MUST be in the same transaction to prevent
    // race conditions (two orders reading "5 in stock" simultaneously).
    // =========================================================================
    "reserve-inventory": {
      process: async ({ job, prepare, complete }) => {
        console.log(`\n[reserve-inventory] ATOMIC mode`);

        const order = await prepare({ mode: "atomic" }, async ({ sql }) => {
          console.log(`  Reading order and checking stock...`);
          const [row] = await sql<{ quantity: number; stock: number; price: number }[]>`
            SELECT o.quantity, p.stock, p.price
            FROM orders o JOIN products p ON p.id = o.product_id
            WHERE o.id = ${job.input.orderId}
          `;
          if (row.stock < row.quantity) {
            throw new Error(`Insufficient stock: ${row.stock} < ${row.quantity}`);
          }
          return row;
        });

        // Complete runs in SAME transaction as prepare (atomic mode)
        return complete(async ({ sql, continueWith }) => {
          console.log(`  Decrementing stock and updating order...`);
          await sql`UPDATE products SET stock = stock - ${order.quantity} WHERE id = (SELECT product_id FROM orders WHERE id = ${job.input.orderId})`;
          await sql`UPDATE orders SET status = 'reserved' WHERE id = ${job.input.orderId}`;
          console.log(`  Transaction committed!`);

          return continueWith({
            typeName: "charge-payment",
            input: { orderId: job.input.orderId, amount: Number(order.price) * order.quantity },
          });
        });
      },
    },

    // =========================================================================
    // STAGED MODE: Charge payment
    // =========================================================================
    // Why staged? We call an external payment API which is slow and may fail.
    // We don't want to hold a database transaction open during the API call.
    // Staged mode: prepare (read) → API call (no tx) → complete (write)
    // =========================================================================
    "charge-payment": {
      process: async ({ job, prepare, complete }) => {
        console.log(`\n[charge-payment] STAGED mode`);

        // Phase 1: Prepare (transaction)
        const orderId = await prepare({ mode: "staged" }, async ({ sql }) => {
          console.log(`  Loading order...`);
          const [row] = await sql<{ id: number; status: string }[]>`
            SELECT id, status FROM orders WHERE id = ${job.input.orderId}
          `;
          if (row.status !== "reserved") throw new Error(`Invalid status: ${row.status}`);
          return row.id;
        });
        console.log(`  Transaction closed, calling external API...`);

        // Phase 2: Processing (no transaction, lease auto-renewed)
        const { paymentId } = await chargePaymentAPI(job.input.amount);
        console.log(`  Payment complete: ${paymentId}`);

        // Phase 3: Complete (new transaction)
        return complete(async ({ sql, continueWith }) => {
          console.log(`  Recording payment...`);
          await sql`UPDATE orders SET status = 'paid', payment_id = ${paymentId} WHERE id = ${orderId}`;
          console.log(`  Transaction committed!`);

          return continueWith({
            typeName: "send-confirmation",
            input: { orderId, paymentId },
          });
        });
      },
    },

    // =========================================================================
    // AUTO-SETUP MODE: Send confirmation
    // =========================================================================
    // Why auto? Simple jobs that don't need explicit prepare/complete control.
    // Just call complete() - the system figures out the mode automatically.
    // =========================================================================
    "send-confirmation": {
      process: async ({ job, complete }) => {
        console.log(`\n[send-confirmation] AUTO-SETUP mode`);
        console.log(`  Sending confirmation for order ${job.input.orderId}...`);

        // Simulate sending email
        await new Promise((r) => setTimeout(r, 100));

        return complete(async ({ sql }) => {
          await sql`UPDATE orders SET status = 'confirmed' WHERE id = ${job.input.orderId}`;
          return { confirmedAt: new Date().toISOString() };
        });
      },
    },
  },
});

// ============================================================================
// 7. Run the workflow
// ============================================================================

console.log("\n" + "=".repeat(60));
console.log("PROCESSING MODES SHOWCASE");
console.log("=".repeat(60));

const stopWorker = await worker.start();

// Create order and start workflow atomically
const chain = await client.withNotify(async () =>
  sql.begin(async (_sql) => {
    const txSql = _sql as TransactionSql;
    const [order] = await txSql<{ id: number }[]>`
      INSERT INTO orders (product_id, quantity, status)
      VALUES (1, 2, 'pending')
      RETURNING id
    `;
    console.log(`\nCreated order #${order.id} for 2x Widget Pro`);

    return client.startJobChain({
      sql: txSql,
      typeName: "reserve-inventory",
      input: { orderId: order.id },
    });
  }),
);

const result = await client.waitForJobChainCompletion(chain, { timeoutMs: 10000 });

console.log("\n" + "=".repeat(60));
console.log("WORKFLOW COMPLETED");
console.log("=".repeat(60));

const [finalOrder] = await sql<
  { status: string; payment_id: string }[]
>`SELECT status, payment_id FROM orders WHERE id = 1`;
const [finalProduct] = await sql<{ stock: number }[]>`SELECT stock FROM products WHERE id = 1`;

console.log(`Order status: ${finalOrder.status}`);
console.log(`Product stock: ${finalProduct.stock} (was 5, ordered 2)`);
console.log(`Payment ID: ${finalOrder.payment_id}`);
console.log(`Confirmed at: ${result.output.confirmedAt}`);

// ============================================================================
// 8. Cleanup
// ============================================================================

await stopWorker();
await sql.end();
await pgContainer.stop();
console.log("\nDone!");
