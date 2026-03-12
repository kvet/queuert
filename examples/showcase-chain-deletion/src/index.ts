/**
 * Chain Deletion Showcase
 *
 * Demonstrates deleting job chains with blocker safety and cascade deletion.
 *
 * Scenarios:
 * 1. Simple Deletion: Delete a completed chain
 * 2. Blocker Safety: Deletion rejected when chain is referenced as a blocker
 * 3. Co-deletion: Delete a chain together with its blocker
 * 4. Cascade Deletion: Automatically resolve and delete transitive dependencies
 */

import { type PgStateProvider, createPgStateAdapter } from "@queuert/postgres";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, {
  type PendingQuery,
  type Row,
  type TransactionSql as _TransactionSql,
} from "postgres";
import {
  BlockerReferenceError,
  createClient,
  createInProcessWorker,
  createJobTypeProcessorRegistry,
  defineJobTypeRegistry,
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

const jobTypeRegistry = defineJobTypeRegistry<{
  /*
   * Workflow:
   *   fetch-data[0] --+
   *   fetch-data[1] --+--> generate-report --> send-report
   *   fetch-data[2] --+
   */
  "fetch-data": {
    entry: true;
    input: { sourceId: string };
    output: { sourceId: string; data: string };
  };
  "generate-report": {
    entry: true;
    input: { reportId: string };
    output: { reportId: string; summary: string };
    blockers: [...{ typeName: "fetch-data" }[]];
    continueWith: { typeName: "send-report" };
  };
  "send-report": {
    input: { reportId: string; summary: string };
    output: { sentAt: string };
  };

  "standalone-task": {
    entry: true;
    input: { taskId: string };
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
  registry: jobTypeRegistry,
});

const worker = await createInProcessWorker({
  client,
  processorRegistry: createJobTypeProcessorRegistry(client, jobTypeRegistry, {
    "fetch-data": {
      attemptHandler: async ({ job, complete }) => {
        console.log(`[fetch-data] Fetching ${job.input.sourceId}`);
        return complete(async () => ({
          sourceId: job.input.sourceId,
          data: `Data from ${job.input.sourceId}`,
        }));
      },
    },

    "generate-report": {
      attemptHandler: async ({ job, complete }) => {
        console.log(`[generate-report] Generating ${job.input.reportId}`);
        const summary = job.blockers.map((b) => b.output.data).join(", ");
        return complete(async ({ continueWith }) =>
          continueWith({
            typeName: "send-report",
            input: { reportId: job.input.reportId, summary },
          }),
        );
      },
    },

    "send-report": {
      attemptHandler: async ({ job, complete }) => {
        console.log(`[send-report] Sending report ${job.input.reportId}`);
        return complete(async () => ({ sentAt: new Date().toISOString() }));
      },
    },

    "standalone-task": {
      attemptHandler: async ({ job, complete }) => {
        console.log(`[standalone-task] Running ${job.input.taskId}`);
        return complete(async () => ({ completedAt: new Date().toISOString() }));
      },
    },
  }),
});

const stopWorker = await worker.start();

// Scenario 1: Delete a completed chain
console.log("\n--- Scenario 1: Simple Deletion ---");
console.log("Delete a completed standalone chain.\n");

const standalone = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (_sql) => {
    const txSql = _sql as TransactionSql;
    return client.startJobChain({
      sql: txSql,
      transactionHooks,
      typeName: "standalone-task",
      input: { taskId: "task-001" },
    });
  }),
);

await client.awaitJobChain(standalone, { timeoutMs: 10000 });

const deleted = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (_sql) => {
    const txSql = _sql as TransactionSql;
    return client.deleteJobChains({
      sql: txSql,
      transactionHooks,
      ids: [standalone.id],
    });
  }),
);

console.log(`Deleted ${deleted.length} chain(s)`);
console.log(`  Chain "${deleted[0].typeName}" (status: ${deleted[0].status})`);

// Scenario 2: Blocker safety — deletion rejected
console.log("\n--- Scenario 2: Blocker Safety ---");
console.log("Deleting a blocker chain that is still referenced is rejected.\n");

const [fetchChains, reportChain] = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (_sql) => {
    const txSql = _sql as TransactionSql;
    const fetches = await client.startJobChains({
      sql: txSql,
      transactionHooks,
      items: [
        { typeName: "fetch-data", input: { sourceId: "users" } },
        { typeName: "fetch-data", input: { sourceId: "orders" } },
      ],
    });
    const report = await client.startJobChain({
      sql: txSql,
      transactionHooks,
      typeName: "generate-report",
      input: { reportId: "report-001" },
      blockers: fetches,
    });
    return [fetches, report] as const;
  }),
);

await client.awaitJobChain(reportChain, { timeoutMs: 10000 });

try {
  await withTransactionHooks(async (transactionHooks) =>
    sql.begin(async (_sql) => {
      const txSql = _sql as TransactionSql;
      return client.deleteJobChains({
        sql: txSql,
        transactionHooks,
        ids: [fetchChains[0].id],
      });
    }),
  );
} catch (err) {
  if (err instanceof BlockerReferenceError) {
    console.log(`Deletion rejected: ${err.message}`);
    console.log(`  ${err.references.length} external reference(s) found`);
  }
}

// Scenario 3: Co-deletion — delete chain with its blockers
console.log("\n--- Scenario 3: Co-deletion ---");
console.log("Delete the report chain together with its blocker chains.\n");

const coDeleted = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (_sql) => {
    const txSql = _sql as TransactionSql;
    return client.deleteJobChains({
      sql: txSql,
      transactionHooks,
      ids: [reportChain.id, fetchChains[0].id, fetchChains[1].id],
    });
  }),
);

console.log(`Deleted ${coDeleted.length} chain(s):`);
for (const chain of coDeleted) {
  console.log(`  "${chain.typeName}" (${chain.id})`);
}

// Scenario 4: Cascade deletion
console.log("\n--- Scenario 4: Cascade Deletion ---");
console.log("Cascade resolves transitive dependencies automatically.\n");

const [_fetchChains2, reportChain2] = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (_sql) => {
    const txSql = _sql as TransactionSql;
    const fetches = await client.startJobChains({
      sql: txSql,
      transactionHooks,
      items: [
        { typeName: "fetch-data", input: { sourceId: "products" } },
        { typeName: "fetch-data", input: { sourceId: "inventory" } },
        { typeName: "fetch-data", input: { sourceId: "pricing" } },
      ],
    });
    const report = await client.startJobChain({
      sql: txSql,
      transactionHooks,
      typeName: "generate-report",
      input: { reportId: "report-002" },
      blockers: fetches,
    });
    return [fetches, report] as const;
  }),
);

await client.awaitJobChain(reportChain2, { timeoutMs: 10000 });

const cascadeDeleted = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (_sql) => {
    const txSql = _sql as TransactionSql;
    return client.deleteJobChains({
      sql: txSql,
      transactionHooks,
      ids: [reportChain2.id],
      cascade: true,
    });
  }),
);

console.log(`Cascade deleted ${cascadeDeleted.length} chain(s):`);
for (const chain of cascadeDeleted) {
  console.log(`  "${chain.typeName}" (${chain.id})`);
}

await stopWorker();
await sql.end();
await pgContainer.stop();
