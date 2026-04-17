/**
 * Error Recovery Showcase
 *
 * Demonstrates Queuert's engine-level error recovery guarantees.
 *
 * Scenarios:
 * 1. Constraint Violation in Complete: CHECK fires, savepoint rolls back, job retries
 * 2. Error After Complete: Handler throws after await complete(), completion is rolled back
 * 3. Error Between Prepare and Complete (Staged): External call fails, job retries
 * 4. lastAttemptError Inspection: Previous error available on retry with serialization
 */

import assert from "node:assert/strict";

import { createPgNotifyAdapter, createPgStateAdapter } from "@queuert/postgres";
import { acquirePostgres } from "@queuert/testcontainers";
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
   * Scenario 1: Constraint violation in complete
   *   transfer-funds --> output { transferred }
   *   (CHECK constraint on balance >= 0 fires, savepoint rolls back, job retries)
   */
  "transfer-funds": {
    entry: true;
    input: { fromAccountId: number; toAccountId: number; amount: number };
    output: { transferred: true };
  };

  /*
   * Scenario 2: Error after complete
   *   credit-account --> output { credited }
   *   (Handler throws after await complete(), completion is rolled back)
   */
  "credit-account": {
    entry: true;
    input: { accountId: number; amount: number };
    output: { credited: true };
  };

  /*
   * Scenario 3: Error between prepare and complete (staged)
   *   external-transfer --> output { confirmed }
   *   (External API call fails between phases, prepare committed, job retries)
   */
  "external-transfer": {
    entry: true;
    input: { accountId: number; amount: number };
    output: { confirmed: true };
  };

  /*
   * Scenario 4: lastAttemptError inspection
   *   flaky-job --> output { attempt }
   *   (Throws different error types, inspects lastAttemptError on retry)
   */
  "flaky-job": {
    entry: true;
    input: null;
    output: { attempt: number };
  };
}>();

let externalApiShouldFail = true;

await using pg = await acquirePostgres("postgres:18", import.meta.url);
const sql = postgres(pg.connectionString, { max: 10 });

const stateProvider = createPostgresJsStateProvider({ sql });
const stateAdapter = await createPgStateAdapter({ stateProvider });
await stateAdapter.migrateToLatest();
const notifyProvider = createPostgresJsNotifyProvider({ sql });
const notifyAdapter = await createPgNotifyAdapter({ notifyProvider });

await sql`
  CREATE TABLE IF NOT EXISTS accounts (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    balance NUMERIC(10, 2) NOT NULL DEFAULT 0,
    CONSTRAINT positive_balance CHECK (balance >= 0)
  )
`;

await sql`INSERT INTO accounts (name, balance) VALUES ('Alice', 100)`;
await sql`INSERT INTO accounts (name, balance) VALUES ('Bob', 50)`;

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
      "transfer-funds": {
        backoffConfig: { initialDelayMs: 500, multiplier: 1, maxDelayMs: 500 },
        attemptHandler: async ({ job, complete }) => {
          console.log(
            `  [transfer-funds] Attempt ${job.attempt}: transferring $${job.input.amount}`,
          );

          return complete(async ({ sql }) => {
            await sql`UPDATE accounts SET balance = balance - ${job.input.amount} WHERE id = ${job.input.fromAccountId}`;
            await sql`UPDATE accounts SET balance = balance + ${job.input.amount} WHERE id = ${job.input.toAccountId}`;
            console.log(`  Transfer committed`);
            return { transferred: true };
          });
        },
      },

      "credit-account": {
        backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
        attemptHandler: async ({ job, complete }) => {
          console.log(`  [credit-account] Attempt ${job.attempt}: crediting $${job.input.amount}`);

          const result = await complete(async ({ sql }) => {
            await sql`UPDATE accounts SET balance = balance + ${job.input.amount} WHERE id = ${job.input.accountId}`;
            console.log(`  Credit committed (will be rolled back if handler throws)`);
            return { credited: true };
          });

          if (job.attempt === 1) {
            throw new Error("Post-complete crash");
          }

          return result;
        },
      },

      "external-transfer": {
        backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
        attemptHandler: async ({ job, prepare, complete }) => {
          console.log(`  [external-transfer] Attempt ${job.attempt}`);

          const account = await prepare({ mode: "staged" }, async ({ sql }) => {
            const rows = await sql<
              { id: number; balance: number }[]
            >`SELECT id, balance FROM accounts WHERE id = ${job.input.accountId}`;
            const row = rows[0];
            console.log(`  Prepare: read account ${row.id}, balance $${row.balance}`);
            return row;
          });

          console.log(`  Calling external API...`);
          if (externalApiShouldFail) {
            externalApiShouldFail = false;
            throw new Error("External API unavailable");
          }
          console.log(`  External API succeeded`);

          return complete(async ({ sql }) => {
            await sql`UPDATE accounts SET balance = balance + ${job.input.amount} WHERE id = ${account.id}`;
            console.log(`  Complete: credited $${job.input.amount} to account ${account.id}`);
            return { confirmed: true };
          });
        },
      },

      "flaky-job": {
        backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
        attemptHandler: async ({ job, complete }) => {
          console.log(`  [flaky-job] Attempt ${job.attempt}`);

          if (job.lastAttemptError != null) {
            console.log(`  Previous error: ${job.lastAttemptError.slice(0, 100)}`);
          }

          if (job.attempt === 1) {
            throw new Error("network timeout");
          }
          if (job.attempt === 2) {
            // oxlint-disable-next-line typescript/only-throw-error -- intentionally throwing non-Error
            throw { code: "VALIDATION", detail: "missing field" };
          }

          return complete(async () => ({ attempt: job.attempt }));
        },
      },
    },
  }),
});

const stopWorker = await worker.start();

// Scenario 1: Constraint violation in complete
console.log("\n--- Scenario 1: Constraint Violation in Complete ---");
console.log(
  "Transfer $200 from Bob (balance $50). CHECK fires, savepoint rolls back, job retries.\n",
);

const transfer = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (txSql) => {
    const result = await client.startJobChain({
      sql: txSql,
      transactionHooks,
      typeName: "transfer-funds",
      input: { fromAccountId: 2, toAccountId: 1, amount: 200 },
    });
    return result;
  }),
);

setTimeout(() => {
  console.log(`  [external] Topping up Bob's account to $300`);
  sql`UPDATE accounts SET balance = 300 WHERE id = 2`.catch(() => {});
}, 200);

const transferResult = await client.awaitJobChain(transfer, { timeoutMs: 5000 });
assert.deepStrictEqual(transferResult.output, { transferred: true });

const [alice1] = await sql<{ balance: string }[]>`SELECT balance FROM accounts WHERE id = 1`;
const [bob1] = await sql<{ balance: string }[]>`SELECT balance FROM accounts WHERE id = 2`;
console.log(`Final balances: Alice=$${alice1.balance}, Bob=$${bob1.balance}`);
assert.equal(Number(alice1.balance), 300);
assert.equal(Number(bob1.balance), 100);

// Scenario 2: Error after complete
console.log("\n--- Scenario 2: Error After Complete ---");
console.log("Credit $50 to Alice. Handler crashes after complete(), completion is rolled back.\n");

const credit = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (txSql) => {
    const result = await client.startJobChain({
      sql: txSql,
      transactionHooks,
      typeName: "credit-account",
      input: { accountId: 1, amount: 50 },
    });
    return result;
  }),
);

const creditResult = await client.awaitJobChain(credit, { timeoutMs: 5000 });
assert.deepStrictEqual(creditResult.output, { credited: true });

const [alice2] = await sql<{ balance: string }[]>`SELECT balance FROM accounts WHERE id = 1`;
console.log(`Alice's balance: $${alice2.balance} (should be $350, not $400)`);
assert.equal(Number(alice2.balance), 350);

// Scenario 3: Error between prepare and complete (staged)
console.log("\n--- Scenario 3: Error Between Prepare and Complete (Staged) ---");
console.log("External API fails between phases. Prepare committed, job retries.\n");

externalApiShouldFail = true;
const externalTransfer = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (txSql) => {
    const result = await client.startJobChain({
      sql: txSql,
      transactionHooks,
      typeName: "external-transfer",
      input: { accountId: 2, amount: 25 },
    });
    return result;
  }),
);

const externalResult = await client.awaitJobChain(externalTransfer, { timeoutMs: 5000 });
assert.deepStrictEqual(externalResult.output, { confirmed: true });

const [bob3] = await sql<{ balance: string }[]>`SELECT balance FROM accounts WHERE id = 2`;
console.log(`Bob's balance: $${bob3.balance} (should be $125)`);
assert.equal(Number(bob3.balance), 125);

// Scenario 4: lastAttemptError inspection
console.log("\n--- Scenario 4: lastAttemptError Inspection ---");
console.log("Job throws different error types, inspects lastAttemptError on retry.\n");

const flakyJob = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (txSql) => {
    const result = await client.startJobChain({
      sql: txSql,
      transactionHooks,
      typeName: "flaky-job",
      input: null,
    });
    return result;
  }),
);

const flakyResult = await client.awaitJobChain(flakyJob, { timeoutMs: 5000 });
console.log(`Completed on attempt ${flakyResult.output.attempt}`);
assert.equal(flakyResult.output.attempt, 3);

await stopWorker();
await sql.end();
