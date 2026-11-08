import { createPgStateAdapter } from "@queuert/postgres";
import { acquirePostgres } from "@queuert/testcontainers";
import knexFactory from "knex";
import {
  createClient,
  createInProcessNotifyAdapter,
  createInProcessWorker,
  createProcessors,
  defineJobTypes,
  withTxHooks,
} from "queuert";

import { createKnexPgStateProvider } from "./provider.ts";

// Start PostgreSQL using testcontainers
await using pg = await acquirePostgres("postgres:18", import.meta.url);

// Create database connection
const knex = knexFactory({
  client: "pg",
  connection: pg.connectionString,
  pool: { min: 0, max: 10 },
});

// Create application schema
await knex.raw(`
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL
  );
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
const stateProvider = createKnexPgStateProvider({ knex });
const stateAdapter = await createPgStateAdapter({
  stateProvider,
});
await stateAdapter.migrateToLatest();
// #endregion

const notifyAdapter = await createInProcessNotifyAdapter();

const client = await createClient({
  stateAdapter,
  notifyAdapter,
  jobTypes,
});

// Create worker with job type processors
const worker = await createInProcessWorker({
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

const stopWorker = await worker.start();

// Register a new user and queue welcome email atomically
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

// Wait for the chain to complete
const result = await client.awaitChain(chain, { timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);

// Cleanup
await stopWorker();
await notifyAdapter.close();
await stateAdapter.close();
await knex.destroy();
