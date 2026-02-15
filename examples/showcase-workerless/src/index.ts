/**
 * Workerless Completion Showcase
 *
 * Demonstrates completing jobs externally without a worker using completeJobChain.
 *
 * Scenarios:
 * 1. Approval Workflow: Job waits for external approval, completed via API
 * 2. Deferred Start with Early Completion: Scheduled timeout with early action option
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
   * Workflow (approval):
   *   await-approval (scheduled timeout)
   *        |
   *        +---> (external approval) ---> process-approved
   *        |
   *        +---> (external rejection) --> output { rejected }
   *        |
   *        v (timeout)
   *   output { rejected: "timeout" }
   */
  "await-approval": {
    entry: true;
    input: { requestId: string; requester: string };
    output: { rejected: true; reason: string };
    continueWith: { typeName: "process-approved" };
  };
  "process-approved": {
    input: { requestId: string };
    output: { processed: true; completedAt: string };
  };

  /*
   * Workflow (pending-action):
   *   pending-action (scheduled timeout)
   *        |
   *        +---> (external completion) --> output { completed }
   *        |
   *        v (timeout)
   *   output { expired }
   */
  "pending-action": {
    entry: true;
    input: { actionId: string; expiresInMs: number };
    output: { expired: true } | { completed: true; result: string };
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
    "await-approval": {
      attemptHandler: async ({ job, complete }) => {
        console.log(`[await-approval] Timeout reached for ${job.input.requestId} - auto-rejecting`);
        return complete(async () => ({ rejected: true, reason: "timeout" }));
      },
    },

    "process-approved": {
      attemptHandler: async ({ job, complete }) => {
        console.log(`[process-approved] Processing approved request ${job.input.requestId}`);
        return complete(async () => ({ processed: true, completedAt: new Date().toISOString() }));
      },
    },

    "pending-action": {
      attemptHandler: async ({ job, complete }) => {
        console.log(`[pending-action] Action ${job.input.actionId} expired`);
        return complete(async () => ({ expired: true }));
      },
    },
  },
});

const stopWorker = await worker.start();

// Scenario 1a: Approval workflow - approved externally
console.log("\n--- Scenario 1a: Approval Workflow (Approved) ---");
console.log("Job is completed externally before worker timeout.\n");

const approval1 = await client.withNotify(async () =>
  sql.begin(async (_sql) => {
    const txSql = _sql as TransactionSql;
    return client.startJobChain({
      sql: txSql,
      typeName: "await-approval",
      input: { requestId: "req-001", requester: "alice" },
      schedule: { afterMs: 5000 }, // Would auto-reject after 5s
    });
  }),
);
console.log(`Created approval request: ${approval1.id} (scheduled for 5s timeout)`);

console.log(`Approving externally...`);
await client.withNotify(async () =>
  sql.begin(async (_sql) => {
    const txSql = _sql as TransactionSql;
    return client.completeJobChain({
      sql: txSql,
      id: approval1.id,
      typeName: "await-approval",
      complete: async ({ job, complete }) => {
        if (job.typeName !== "await-approval") return;
        await complete(job, async ({ continueWith }) =>
          continueWith({
            typeName: "process-approved",
            input: { requestId: job.input.requestId },
          }),
        );
      },
    });
  }),
);

const result1 = await client.waitForJobChainCompletion(approval1, { timeoutMs: 10000 });
console.log(`Result: ${JSON.stringify(result1.output)}`);

// Scenario 1b: Approval workflow - rejected externally
console.log("\n--- Scenario 1b: Approval Workflow (Rejected) ---");
console.log("Job is rejected externally.\n");

const approval2 = await client.withNotify(async () =>
  sql.begin(async (_sql) => {
    const txSql = _sql as TransactionSql;
    return client.startJobChain({
      sql: txSql,
      typeName: "await-approval",
      input: { requestId: "req-002", requester: "bob" },
      schedule: { afterMs: 5000 },
    });
  }),
);
console.log(`Created approval request: ${approval2.id}`);

console.log(`Rejecting externally...`);
await client.withNotify(async () =>
  sql.begin(async (_sql) => {
    const txSql = _sql as TransactionSql;
    return client.completeJobChain({
      sql: txSql,
      id: approval2.id,
      typeName: "await-approval",
      complete: async ({ job, complete }) => {
        if (job.typeName !== "await-approval") return;
        await complete(job, async () => ({ rejected: true, reason: "manager_denied" }));
      },
    });
  }),
);

const result2 = await client.waitForJobChainCompletion(approval2, { timeoutMs: 10000 });
console.log(`Result: ${JSON.stringify(result2.output)}`);

// Scenario 2: Deferred start with early completion
console.log("\n--- Scenario 2: Deferred Start with Early Completion ---");
console.log("Job scheduled to expire, but completed early.\n");

const action = await client.withNotify(async () =>
  sql.begin(async (_sql) => {
    const txSql = _sql as TransactionSql;
    return client.startJobChain({
      sql: txSql,
      typeName: "pending-action",
      input: { actionId: "action-001", expiresInMs: 5000 },
      schedule: { afterMs: 5000 }, // Would expire after 5s
    });
  }),
);
console.log(`Created pending action: ${action.id} (expires in 5s)`);

console.log(`Completing early...`);
await client.withNotify(async () =>
  sql.begin(async (_sql) => {
    const txSql = _sql as TransactionSql;
    return client.completeJobChain({
      sql: txSql,
      id: action.id,
      typeName: "pending-action",
      complete: async ({ job, complete }) => {
        if (job.typeName !== "pending-action") return;
        await complete(job, async () => ({ completed: true, result: "User clicked confirm" }));
      },
    });
  }),
);

const result3 = await client.waitForJobChainCompletion(action, { timeoutMs: 10000 });
console.log(`Result: ${JSON.stringify(result3.output)}`);

await stopWorker();
await sql.end();
await pgContainer.stop();
