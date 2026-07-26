import { createSqliteStateAdapter } from "@queuert/sqlite";
import type Database from "better-sqlite3";
import knexFactory from "knex";
import {
  createClient,
  createInProcessNotifyAdapter,
  createInProcessWorker,
  createProcessors,
  defineJobTypes,
  withTransactionHooks,
} from "queuert";

import { createKnexSqliteStateProvider } from "./provider.js";

// 1. Create in-memory SQLite database and configure pragmas per connection
const knex = knexFactory({
  client: "better-sqlite3",
  connection: { filename: ":memory:" },
  useNullAsDefault: true,
  pool: {
    afterCreate: (conn: Database.Database, done: (err: Error | null) => void) => {
      conn.pragma("auto_vacuum = INCREMENTAL");
      conn.pragma("foreign_keys = ON");
      done(null);
    },
  },
});

// 2. Create application schema
await knex.raw(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL
  )
`);

// 3. Define job types
const jobTypes = defineJobTypes<{
  send_welcome_email: {
    entry: true;
    input: { userId: number };
    output: { sentAt: string };
  };
}>();

// 4. Create state provider for Knex
const stateProvider = createKnexSqliteStateProvider({ knex });

// 5. Create adapters and queuert client/worker
const stateAdapter = await createSqliteStateAdapter({
  stateProvider,
});
await stateAdapter.migrateToLatest();

const notifyAdapter = await createInProcessNotifyAdapter();

const client = await createClient({
  stateAdapter,
  notifyAdapter,
  jobTypes,
});

// 6. Create worker with job type processors
const worker = await createInProcessWorker({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      send_welcome_email: {
        attemptHandler: async ({ job, prepare, complete }) => {
          // Load the user with Knex inside the job transaction
          const user = await prepare({ mode: "staged" }, async ({ trx }) =>
            trx<{ id: number; name: string; email: string }>("users")
              .where({ id: job.input.userId })
              .first(),
          );
          if (!user) throw new Error(`User ${job.input.userId} not found`);

          // Simulate sending email (in real app, call email service here)
          console.log(`Sending welcome email to ${user.email} for ${user.name}`);

          return complete(async () => ({
            sentAt: new Date().toISOString(),
          }));
        },
      },
    },
  }),
});

const stopWorker = await worker.start();

// 7. Register a new user and queue welcome email atomically
const chain = await withTransactionHooks(async (transactionHooks) =>
  knex.transaction(async (trx) => {
    const [user] = await trx<{ id: number; name: string; email: string }>("users")
      .insert({ name: "Alice", email: "alice@example.com" })
      .returning(["id"]);

    // Queue welcome email - if user creation fails, no email job is created
    return client.startChain({
      trx,
      transactionHooks,
      typeName: "send_welcome_email",
      input: { userId: user.id },
    });
  }),
);

// 8. Wait for the chain to complete
const result = await client.awaitChain(chain, { timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);

// 9. Cleanup
await stopWorker();
await notifyAdapter.close();
await stateAdapter.close();
await knex.destroy();
