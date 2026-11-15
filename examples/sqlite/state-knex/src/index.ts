import assert from "node:assert/strict";

import { createSqliteMigrator, createSqliteStateAdapter } from "@queuert/sqlite";
import knexFactory from "knex";
import {
  createClient,
  createWorkerRunner,
  createProcessors,
  defineJobTypes,
  withTxHooks,
} from "queuert";

import { type Invoice, createMigrations } from "./migrations.ts";
import { createKnexSqliteStateProvider } from "./provider.ts";

// Create in-memory SQLite database
await using drivers = new AsyncDisposableStack();
const knex = drivers.adopt(
  knexFactory({
    client: "better-sqlite3",
    connection: { filename: ":memory:" },
    useNullAsDefault: true,
  }),
  async (knex) => knex.destroy(),
);

// Create application schema
await knex.raw(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL
  )
`);

// Define job types
const jobTypes = defineJobTypes<{
  send_welcome_email: {
    entry: true;
    input: { userId: number };
    output: { sentAt: string };
  };
}>();

// Create state provider for Knex
// #region adapter
const stateProvider = createKnexSqliteStateProvider({ knex });
await using stateAdapter = createSqliteStateAdapter({
  stateProvider,
});
await stateAdapter.migrateToLatest();
// #endregion

const migrator = createSqliteMigrator({
  stateProvider,
  migrations: createMigrations({ db: knex }),
});
const { applied } = await migrator.migrateToLatest();
console.log(`Applied application migrations: ${applied.join(", ")}`);
assert.deepEqual(
  await knex<Invoice>("invoices").select().orderBy("id"),
  [1, 2, 3, 4, 5].map((id) => ({ id, customer: `CUSTOMER-${id}`, status: "open" })),
);

const client = createClient({ stateAdapter, jobTypes });

// Create worker runner with job type processors
await using workerRunner = createWorkerRunner({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      send_welcome_email: {
        attemptHandler: async ({ job, complete }) => {
          const user = await knex<{ id: number; name: string; email: string }>("users")
            .where({ id: job.input.userId })
            .first();
          if (!user) throw new Error(`User ${job.input.userId} not found`);

          // Simulate sending email (in real app, call email service here)
          console.log(`Sending welcome email to ${user.email} for ${user.name}`);

          // Knex holds its single SQLite connection for the whole transaction, so the
          // worker's own statements cannot run inside it.
          return withTxHooks(async (txHooks) =>
            knex.transaction(
              async (trx) =>
                complete({ trx, txHooks, output: { sentAt: new Date().toISOString() } }),
              { doNotRejectOnRollback: false },
            ),
          );
        },
      },
    },
  }),
});

await workerRunner.start();

// Register a new user and queue welcome email atomically
// #region create-chain
const chain = await withTxHooks(async (txHooks) =>
  knex.transaction(
    async (trx) => {
      const [user] = await trx<{ id: number; name: string; email: string }>("users")
        .insert({ name: "Alice", email: "alice@example.com" })
        .returning(["id"]);

      // Queue welcome email - if user creation fails, no email job is created
      return client.createChain({
        trx,
        txHooks,
        typeName: "send_welcome_email",
        input: { userId: user.id },
      });
    },
    { doNotRejectOnRollback: false },
  ),
);
// #endregion

// Wait for the chain to complete
const result = await client.awaitChain(chain, { timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);
