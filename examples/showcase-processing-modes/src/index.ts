/**
 * Processing Modes Showcase
 *
 * Demonstrates processing modes through an order fulfillment workflow.
 *
 * Scenarios:
 * 1. Auto-Setup Atomic: Just call complete() directly — simplest path
 * 2. Staged Mode: Use prepare() when external API calls happen between transactions
 * 3. Auto-Setup Staged: Async work before complete() without explicit prepare()
 */

import assert from "node:assert/strict";

import { createPgNotifyAdapter, createPgStateAdapter } from "@queuert/postgres";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { createPostgresJsNotifyProvider } from "example-notify-postgres-postgres-js/provider";
import { createPostgresJsStateProvider } from "example-state-postgres-postgres-js/provider";
import postgres from "postgres";
import {
  createClient,
  createInProcessWorker,
  createJobTypeProcessorRegistry,
  defineJobTypeRegistry,
  withTransactionHooks,
} from "queuert";

const jobTypeRegistry = defineJobTypeRegistry<{
  /*
   * Workflow:
   *   reserve-inventory (auto-setup atomic)
   *          |
   *          v
   *   charge-payment (staged)
   *          |
   *          v
   *   send-confirmation (auto-setup staged)
   */
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

async function chargePaymentAPI(amount: number): Promise<{ paymentId: string }> {
  console.log(`  [Payment API] Processing $${amount}...`);
  await new Promise((r) => setTimeout(r, 500));
  return { paymentId: `pay_${Date.now()}` };
}

const pgContainer = await new PostgreSqlContainer("postgres:18").withExposedPorts(5432).start();
const sql = postgres(pgContainer.getConnectionUri(), { max: 10 });

const stateProvider = createPostgresJsStateProvider({ sql });
const stateAdapter = await createPgStateAdapter({ stateProvider });
await stateAdapter.migrateToLatest();
const notifyProvider = createPostgresJsNotifyProvider({ sql });
const notifyAdapter = await createPgNotifyAdapter({ provider: notifyProvider });

// Create schema
await sql`
  CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    price NUMERIC(10, 2) NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    payment_id TEXT
  )
`;

await sql`INSERT INTO products (name, price, stock) VALUES ('Widget Pro', 99.99, 5) ON CONFLICT DO NOTHING`;

const client = await createClient({
  stateAdapter,
  notifyAdapter,
  jobTypeRegistry,
});

const worker = await createInProcessWorker({
  client,
  jobTypeProcessorRegistry: createJobTypeProcessorRegistry({
    client,
    jobTypeRegistry,
    processors: {
      "reserve-inventory": {
        attemptHandler: async ({ job, complete }) => {
          console.log(`\n[reserve-inventory] AUTO-SETUP ATOMIC mode`);

          return complete(async ({ sql, continueWith }) => {
            console.log(`  Reading order, checking stock, and reserving...`);
            const rows = await sql<
              {
                quantity: number;
                stock: number;
                price: number;
              }[]
            >`SELECT o.quantity, p.stock, p.price FROM orders o JOIN products p ON p.id = o.product_id WHERE o.id = ${job.input.orderId}`;
            const order = rows[0];
            if (order.stock < order.quantity) {
              throw new Error(`Insufficient stock: ${order.stock} < ${order.quantity}`);
            }
            await sql`UPDATE products SET stock = stock - ${order.quantity} WHERE id = (SELECT product_id FROM orders WHERE id = ${job.input.orderId})`;
            await sql`UPDATE orders SET status = 'reserved' WHERE id = ${job.input.orderId}`;
            console.log(`  Transaction committed!`);

            return continueWith({
              typeName: "charge-payment",
              input: { orderId: job.input.orderId, amount: order.price * order.quantity },
            });
          });
        },
      },

      "charge-payment": {
        attemptHandler: async ({ job, prepare, complete }) => {
          console.log(`\n[charge-payment] STAGED mode`);

          const orderId = await prepare({ mode: "staged" }, async ({ sql }) => {
            console.log(`  Loading order...`);
            const rows = await sql<
              { id: number; status: string }[]
            >`SELECT id, status FROM orders WHERE id = ${job.input.orderId}`;
            const row = rows[0];
            if (row.status !== "reserved") throw new Error(`Invalid status: ${row.status}`);
            return row.id;
          });
          console.log(`  Transaction closed, calling external API...`);

          const { paymentId } = await chargePaymentAPI(job.input.amount);
          console.log(`  Payment complete: ${paymentId}`);

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

      "send-confirmation": {
        attemptHandler: async ({ job, complete }) => {
          console.log(`\n[send-confirmation] AUTO-SETUP STAGED mode`);
          console.log(`  Sending confirmation for order ${job.input.orderId}...`);

          await new Promise((r) => setTimeout(r, 100));

          return complete(async ({ sql }) => {
            await sql`UPDATE orders SET status = 'confirmed' WHERE id = ${job.input.orderId}`;
            return { confirmedAt: new Date().toISOString() };
          });
        },
      },
    },
  }),
});

const stopWorker = await worker.start();

console.log("\n--- Processing Modes: Order Fulfillment Workflow ---");
console.log("Auto-setup atomic -> Staged -> Auto-setup staged processing modes.\n");

const jobChain = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (txSql) => {
    const [order] = await txSql<
      { id: number }[]
    >`INSERT INTO orders (product_id, quantity, status) VALUES (1, 2, 'pending') RETURNING id`;
    console.log(`Created order #${order.id} for 2x Widget Pro`);

    const result = await client.startJobChain({
      sql: txSql,
      transactionHooks,
      typeName: "reserve-inventory",
      input: { orderId: order.id },
    });
    return result;
  }),
);

const result = await client.awaitJobChain(jobChain, { timeoutMs: 10000 });

console.log("\n" + "-".repeat(40));
console.log("WORKFLOW COMPLETED");
console.log("-".repeat(40));

const [finalOrder] = await sql<
  { status: string; payment_id: string }[]
>`SELECT status, payment_id FROM orders WHERE id = ${jobChain.input.orderId}`;
const [finalProduct] = await sql<{ stock: number }[]>`SELECT stock FROM products WHERE id = 1`;

console.log(`Order status: ${finalOrder.status}`);
console.log(`Product stock: ${finalProduct.stock} (was 5, ordered 2)`);
console.log(`Payment ID: ${finalOrder.payment_id}`);
console.log(`Confirmed at: ${result.output.confirmedAt}`);
assert.equal(finalOrder.status, "confirmed");
assert.equal(finalProduct.stock, 3);
assert.ok(finalOrder.payment_id.startsWith("pay_"));

await stopWorker();
await sql.end();
await pgContainer.stop();
