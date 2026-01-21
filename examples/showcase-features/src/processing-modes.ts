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

import { createQueuertClient, createQueuertInProcessWorker, defineJobTypes } from "queuert";
import { DbContext, SetupContext } from "./setup.js";

// ============================================================================
// Job Types
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
// External API Simulation
// ============================================================================

async function chargePaymentAPI(amount: number): Promise<{ paymentId: string }> {
  console.log(`  [Payment API] Processing $${amount}...`);
  await new Promise((r) => setTimeout(r, 500));
  return { paymentId: `pay_${Date.now()}` };
}

// ============================================================================
// Main Function
// ============================================================================

export async function runProcessingModesShowcase(setup: SetupContext): Promise<void> {
  const { sql, stateAdapter, notifyAdapter, log } = setup;

  console.log("\n" + "=".repeat(60));
  console.log("PROCESSING MODES SHOWCASE");
  console.log("=".repeat(60));

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
      // ATOMIC MODE: Reserve inventory
      // =========================================================================
      "reserve-inventory": {
        process: async ({ job, prepare, complete }) => {
          console.log(`\n[reserve-inventory] ATOMIC mode`);

          const order = await prepare({ mode: "atomic" }, async ({ sql: txSql }) => {
            console.log(`  Reading order and checking stock...`);
            const [row] = await txSql<{ quantity: number; stock: number; price: number }[]>`
              SELECT o.quantity, p.stock, p.price
              FROM orders o JOIN products p ON p.id = o.product_id
              WHERE o.id = ${job.input.orderId}
            `;
            if (row.stock < row.quantity) {
              throw new Error(`Insufficient stock: ${row.stock} < ${row.quantity}`);
            }
            return row;
          });

          return complete(async ({ sql: txSql, continueWith }) => {
            console.log(`  Decrementing stock and updating order...`);
            await txSql`UPDATE products SET stock = stock - ${order.quantity} WHERE id = (SELECT product_id FROM orders WHERE id = ${job.input.orderId})`;
            await txSql`UPDATE orders SET status = 'reserved' WHERE id = ${job.input.orderId}`;
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
      "charge-payment": {
        process: async ({ job, prepare, complete }) => {
          console.log(`\n[charge-payment] STAGED mode`);

          const orderId = await prepare({ mode: "staged" }, async ({ sql: txSql }) => {
            console.log(`  Loading order...`);
            const [row] = await txSql<{ id: number; status: string }[]>`
              SELECT id, status FROM orders WHERE id = ${job.input.orderId}
            `;
            if (row.status !== "reserved") throw new Error(`Invalid status: ${row.status}`);
            return row.id;
          });
          console.log(`  Transaction closed, calling external API...`);

          const { paymentId } = await chargePaymentAPI(job.input.amount);
          console.log(`  Payment complete: ${paymentId}`);

          return complete(async ({ sql: txSql, continueWith }) => {
            console.log(`  Recording payment...`);
            await txSql`UPDATE orders SET status = 'paid', payment_id = ${paymentId} WHERE id = ${orderId}`;
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
      "send-confirmation": {
        process: async ({ job, complete }) => {
          console.log(`\n[send-confirmation] AUTO-SETUP mode`);
          console.log(`  Sending confirmation for order ${job.input.orderId}...`);

          await new Promise((r) => setTimeout(r, 100));

          return complete(async ({ sql: txSql }) => {
            await txSql`UPDATE orders SET status = 'confirmed' WHERE id = ${job.input.orderId}`;
            return { confirmedAt: new Date().toISOString() };
          });
        },
      },
    },
  });

  // Run the workflow
  const stopWorker = await worker.start();

  const chain = await client.withNotify(async () =>
    sql.begin(async (_sql) => {
      const txSql = _sql as DbContext["sql"];
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

  console.log("\n" + "-".repeat(40));
  console.log("WORKFLOW COMPLETED");
  console.log("-".repeat(40));

  const [finalOrder] = await sql<
    { status: string; payment_id: string }[]
  >`SELECT status, payment_id FROM orders WHERE id = ${chain.input.orderId}`;
  const [finalProduct] = await sql<{ stock: number }[]>`SELECT stock FROM products WHERE id = 1`;

  console.log(`Order status: ${finalOrder.status}`);
  console.log(`Product stock: ${finalProduct.stock} (was 5, ordered 2)`);
  console.log(`Payment ID: ${finalOrder.payment_id}`);
  console.log(`Confirmed at: ${result.output.confirmedAt}`);

  await stopWorker();
}
