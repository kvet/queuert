/**
 * Job Chain Awaiting Showcase
 *
 * Demonstrates waiting for job chain completion with polling and notifications.
 *
 * Scenarios:
 * 1. Basic Awaiting: Wait for a chain to complete and access typed output
 * 2. Parallel Awaiting: Wait for multiple chains concurrently
 * 3. Timeout Handling: Handle chains that don't complete in time
 * 4. Abort Signal: Cancel awaiting with an AbortSignal
 */

import { type PgStateProvider, createPgStateAdapter } from "@queuert/postgres";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, {
  type PendingQuery,
  type Row,
  type TransactionSql as _TransactionSql,
} from "postgres";
import {
  WaitChainTimeoutError,
  createClient,
  createInProcessWorker,
  defineJobTypes,
  withTransactionHooks,
} from "queuert";
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
   *   fetch-price --> apply-discount
   */
  "fetch-price": {
    entry: true;
    input: { productId: string };
    continueWith: { typeName: "apply-discount" };
  };
  "apply-discount": {
    input: { productId: string; basePrice: number };
    output: { productId: string; finalPrice: number };
  };

  "long-running": {
    entry: true;
    input: { durationMs: number };
    output: { completedAt: string };
  };
}>();

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
  executeSql: async ({ txCtx, sql: query, params }) => {
    const client = txCtx?.sql ?? sql;
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

const PRICES: Record<string, number> = {
  widget: 29.99,
  gadget: 49.99,
  gizmo: 19.99,
};

const worker = await createInProcessWorker({
  client,
  processors: {
    "fetch-price": {
      attemptHandler: async ({ job, complete }) => {
        const basePrice = PRICES[job.input.productId] ?? 9.99;
        console.log(`[fetch-price] ${job.input.productId}: $${basePrice}`);
        return complete(async ({ continueWith }) =>
          continueWith({
            typeName: "apply-discount",
            input: { productId: job.input.productId, basePrice },
          }),
        );
      },
    },

    "apply-discount": {
      attemptHandler: async ({ job, complete }) => {
        const finalPrice = Math.round(job.input.basePrice * 0.9 * 100) / 100;
        console.log(
          `[apply-discount] ${job.input.productId}: $${job.input.basePrice} → $${finalPrice}`,
        );
        return complete(async () => ({
          productId: job.input.productId,
          finalPrice,
        }));
      },
    },

    "long-running": {
      attemptHandler: async ({ job, complete }) => {
        console.log(`[long-running] Sleeping ${job.input.durationMs}ms...`);
        await new Promise((r) => setTimeout(r, job.input.durationMs));
        return complete(async () => ({ completedAt: new Date().toISOString() }));
      },
    },
  },
});

const stopWorker = await worker.start();

// Scenario 1: Basic awaiting
console.log("\n--- Scenario 1: Basic Awaiting ---");
console.log("Start a price lookup chain and await its result.\n");

const priceChain = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (_sql) => {
    const txSql = _sql as TransactionSql;
    return client.startJobChain({
      sql: txSql,
      transactionHooks,
      typeName: "fetch-price",
      input: { productId: "widget" },
    });
  }),
);

const result = await client.awaitJobChain(priceChain, { timeoutMs: 10000 });
console.log(`\nResult: ${result.output.productId} → $${result.output.finalPrice}`);
console.log(`Completed at: ${result.completedAt.toISOString()}`);

// Scenario 2: Parallel awaiting
console.log("\n--- Scenario 2: Parallel Awaiting ---");
console.log("Await multiple chains concurrently with Promise.all.\n");

const chains = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (_sql) => {
    const txSql = _sql as TransactionSql;
    return Promise.all([
      client.startJobChain({
        sql: txSql,
        transactionHooks,
        typeName: "fetch-price",
        input: { productId: "widget" },
      }),
      client.startJobChain({
        sql: txSql,
        transactionHooks,
        typeName: "fetch-price",
        input: { productId: "gadget" },
      }),
      client.startJobChain({
        sql: txSql,
        transactionHooks,
        typeName: "fetch-price",
        input: { productId: "gizmo" },
      }),
    ]);
  }),
);

const results = await Promise.all(
  chains.map(async (c) => client.awaitJobChain(c, { timeoutMs: 10000 })),
);

console.log("\nAll prices:");
for (const r of results) {
  console.log(`  ${r.output.productId}: $${r.output.finalPrice}`);
}

// Scenario 3: Timeout handling
console.log("\n--- Scenario 3: Timeout Handling ---");
console.log("Await a slow chain with a short timeout.\n");

const slowChain = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (_sql) => {
    const txSql = _sql as TransactionSql;
    return client.startJobChain({
      sql: txSql,
      transactionHooks,
      typeName: "long-running",
      input: { durationMs: 5000 },
    });
  }),
);

try {
  await client.awaitJobChain(slowChain, { timeoutMs: 100 });
} catch (err) {
  if (err instanceof WaitChainTimeoutError) {
    console.log(`Timeout: ${err.message}`);
  }
}

// Scenario 4: Abort signal
console.log("\n--- Scenario 4: Abort Signal ---");
console.log("Cancel awaiting with an AbortSignal.\n");

const abortChain = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (_sql) => {
    const txSql = _sql as TransactionSql;
    return client.startJobChain({
      sql: txSql,
      transactionHooks,
      typeName: "long-running",
      input: { durationMs: 5000 },
    });
  }),
);

const controller = new AbortController();
setTimeout(() => {
  controller.abort("User cancelled");
}, 100);

try {
  await client.awaitJobChain(abortChain, {
    timeoutMs: 30000,
    signal: controller.signal,
  });
} catch (err) {
  if (err instanceof WaitChainTimeoutError) {
    console.log(`Aborted: ${err.message}`);
  }
}

await stopWorker();
await sql.end();
await pgContainer.stop();
