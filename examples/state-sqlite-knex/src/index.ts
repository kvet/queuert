import { createSqliteStateAdapter } from "@queuert/sqlite";
import knexFactory from "knex";
import {
  createClient,
  createWorkerRunner,
  createProcessors,
  defineJobTypes,
  withTxHooks,
} from "queuert";

import { createKnexSqliteStateProvider } from "./provider.ts";

// Create in-memory SQLite database
const knex = knexFactory({
  client: "better-sqlite3",
  connection: { filename: ":memory:" },
  useNullAsDefault: true,
});

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
const stateAdapter = createSqliteStateAdapter({
  stateProvider,
});
await stateAdapter.migrateToLatest();
// #endregion

const client = createClient({ stateAdapter, jobTypes });

// Create worker runner with job type processors
const workerRunner = createWorkerRunner({
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

const stopWorkerRunner = await workerRunner.start();

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

// Cleanup
await stopWorkerRunner();
await stateAdapter.close();
await knex.destroy();
