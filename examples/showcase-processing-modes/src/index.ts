/**
 * Processing Modes Showcase
 *
 * Demonstrates the three processing modes through an order fulfillment workflow.
 *
 * Scenarios:
 * 1. Atomic Mode: Prepare and complete run in ONE transaction
 * 2. Staged Mode: Prepare and complete run in SEPARATE transactions
 * 3. Auto-Setup Mode: Just call complete() without prepare()
 */

import { type PgStateProvider, createPgStateAdapter } from "@queuert/postgres";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, {
  type PendingQuery,
  type Row,
  type TransactionSql as _TransactionSql,
} from "postgres";
import { createClient, createInProcessWorker, defineJobTypes } from "queuert";
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
   *   reserve-inventory (atomic)
   *          |
   *          v
   *   charge-payment (staged)
   *          |
   *          v
   *   send-confirmation (auto-setup)
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
  registry: jobTypes,
});

const worker = await createInProcessWorker({
  stateAdapter,
  notifyAdapter,
  registry: jobTypes,
  processors: {
    "reserve-inventory": {
      attemptHandler: async ({ job, prepare, complete }) => {
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

    "charge-payment": {
      attemptHandler: async ({ job, prepare, complete }) => {
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

    "send-confirmation": {
      attemptHandler: async ({ job, complete }) => {
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

const stopWorker = await worker.start();

console.log("\n--- Processing Modes: Order Fulfillment Workflow ---");
console.log("Atomic -> Staged -> Auto-setup processing modes.\n");

const chain = await client.withNotify(async () =>
  sql.begin(async (_sql) => {
    const txSql = _sql as TransactionSql;
    const [order] = await txSql<{ id: number }[]>`
      INSERT INTO orders (product_id, quantity, status)
      VALUES (1, 2, 'pending')
      RETURNING id
    `;
    console.log(`Created order #${order.id} for 2x Widget Pro`);

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
await sql.end();
await pgContainer.stop();
