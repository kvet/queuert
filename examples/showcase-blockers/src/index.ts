/**
 * Job Blockers Showcase
 *
 * Demonstrates how jobs can depend on other job chains to complete before starting.
 *
 * Scenarios:
 * 1. Fan-out/Fan-in: Multiple fetch jobs run in parallel, aggregate waits for all
 * 2. Fixed Slots: Job requires exactly two specific prerequisite jobs
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
   * Workflow (fan-out/fan-in):
   *   fetch-source[0] --+
   *   fetch-source[1] --+--> aggregate-data
   *   fetch-source[2] --+
   */
  "fetch-source": {
    entry: true;
    input: { sourceId: string; url: string };
    output: { sourceId: string; data: string };
  };
  "aggregate-data": {
    entry: true;
    input: { reportId: string };
    output: { reportId: string; totalSources: number; combinedData: string };
    blockers: [...{ typeName: "fetch-source" }[]];
  };

  /*
   * Workflow (fixed slots):
   *   validate-user --+
   *                   +--> perform-action
   *   load-config ----+
   */
  "validate-user": {
    entry: true;
    input: { userId: string };
    output: { userId: string; role: string };
  };
  "load-config": {
    entry: true;
    input: { configKey: string };
    output: { configKey: string; value: string };
  };
  "perform-action": {
    entry: true;
    input: { actionId: string };
    output: { actionId: string; result: string };
    blockers: [{ typeName: "validate-user" }, { typeName: "load-config" }];
  };
}>();

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
    "fetch-source": {
      attemptHandler: async ({ job, complete }) => {
        console.log(`[fetch-source] Fetching ${job.input.sourceId}...`);
        await new Promise((r) => setTimeout(r, 100));
        return complete(async () => ({
          sourceId: job.input.sourceId,
          data: `Data from ${job.input.sourceId}`,
        }));
      },
    },

    "aggregate-data": {
      attemptHandler: async ({ job, complete }) => {
        console.log(`[aggregate-data] Aggregating ${job.blockers.length} sources`);

        for (const blocker of job.blockers) {
          console.log(`  - ${blocker.output.sourceId}: "${blocker.output.data}"`);
        }

        return complete(async () => ({
          reportId: job.input.reportId,
          totalSources: job.blockers.length,
          combinedData: job.blockers.map((b) => b.output.data).join(" | "),
        }));
      },
    },

    "validate-user": {
      attemptHandler: async ({ job, complete }) => {
        console.log(`[validate-user] Validating ${job.input.userId}`);
        return complete(async () => ({ userId: job.input.userId, role: "admin" }));
      },
    },

    "load-config": {
      attemptHandler: async ({ job, complete }) => {
        console.log(`[load-config] Loading ${job.input.configKey}`);
        return complete(async () => ({ configKey: job.input.configKey, value: "production" }));
      },
    },

    "perform-action": {
      attemptHandler: async ({ job, complete }) => {
        const [userBlocker, configBlocker] = job.blockers;
        console.log(
          `[perform-action] User: ${userBlocker.output.role}, Config: ${configBlocker.output.value}`,
        );

        return complete(async () => ({
          actionId: job.input.actionId,
          result: `Completed by ${userBlocker.output.role} with ${configBlocker.output.value}`,
        }));
      },
    },
  },
});

const stopWorker = await worker.start();

// Scenario 1: Fan-out/Fan-in with variadic blockers
console.log("\n--- Scenario 1: Fan-out/Fan-in ---");
console.log("Three fetch jobs run in parallel, aggregate waits for all.\n");

const aggregateChain = await client.withNotify(async () =>
  sql.begin(async (_sql) => {
    const txSql = _sql as TransactionSql;
    return client.startJobChain({
      sql: txSql,
      typeName: "aggregate-data",
      input: { reportId: "report-001" },
      startBlockers: async () =>
        Promise.all([
          client.startJobChain({
            sql: txSql,
            typeName: "fetch-source",
            input: { sourceId: "users", url: "/users" },
          }),
          client.startJobChain({
            sql: txSql,
            typeName: "fetch-source",
            input: { sourceId: "orders", url: "/orders" },
          }),
          client.startJobChain({
            sql: txSql,
            typeName: "fetch-source",
            input: { sourceId: "products", url: "/products" },
          }),
        ]),
    });
  }),
);

const result1 = await client.waitForJobChainCompletion(aggregateChain, { timeoutMs: 10000 });
console.log(`\nResult: ${result1.output.totalSources} sources → "${result1.output.combinedData}"`);

// Scenario 2: Fixed blocker slots
console.log("\n--- Scenario 2: Fixed Blocker Slots ---");
console.log("Action requires exactly: validate-user + load-config.\n");

const actionChain = await client.withNotify(async () =>
  sql.begin(async (_sql) => {
    const txSql = _sql as TransactionSql;
    return client.startJobChain({
      sql: txSql,
      typeName: "perform-action",
      input: { actionId: "action-001" },
      startBlockers: async () => [
        await client.startJobChain({
          sql: txSql,
          typeName: "validate-user",
          input: { userId: "user-123" },
        }),
        await client.startJobChain({
          sql: txSql,
          typeName: "load-config",
          input: { configKey: "settings" },
        }),
      ],
    });
  }),
);

const result2 = await client.waitForJobChainCompletion(actionChain, { timeoutMs: 10000 });
console.log(`\nResult: "${result2.output.result}"`);

await stopWorker();
await sql.end();
await pgContainer.stop();
