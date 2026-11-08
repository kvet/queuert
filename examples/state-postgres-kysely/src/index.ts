import { createPgStateAdapter } from "@queuert/postgres";
import { acquirePostgres } from "@queuert/testcontainers";
import { CompiledQuery, type Generated, Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import {
  createClient,
  createInProcessWorker,
  createProcessors,
  defineJobTypes,
  withTransactionHooks,
  createInProcessNotifyAdapter,
} from "queuert";

import { createKyselyPgStateProvider } from "./provider.ts";

// Start PostgreSQL using testcontainers
await using pg = await acquirePostgres("postgres:18", import.meta.url);

// Define Kysely database schema
type Database = {
  users: { id: Generated<number>; name: string; email: string };
};

// Create database connection and schema
const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({
      connectionString: pg.connectionString,
      max: 10,
    }),
  }),
});

await db.executeQuery(
  CompiledQuery.raw(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL
    );
  `),
);

// Define job types
const jobTypes = defineJobTypes<{
  send_welcome_email: {
    entry: true;
    input: { userId: number };
    output: { sentAt: string };
  };
}>();

// Create state provider for Kysely
// #region adapter
const stateProvider = createKyselyPgStateProvider({ db });
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
          const user = await db
            .selectFrom("users")
            .selectAll()
            .where("id", "=", job.input.userId)
            .executeTakeFirstOrThrow();

          // Simulate sending email (in real app, call email service here)
          console.log(`Sending welcome email to ${user.email} for ${user.name}`);

          return withTransactionHooks(async (transactionHooks) =>
            db
              .transaction()
              .execute(async (db) =>
                complete({ db, transactionHooks, output: { sentAt: new Date().toISOString() } }),
              ),
          );
        },
      },
    },
  }),
});

const stopWorker = await worker.start();

// Register a new user and queue welcome email atomically
const chain = await withTransactionHooks(async (transactionHooks) =>
  db.transaction().execute(async (db) => {
    const user = await db
      .insertInto("users")
      .values({ name: "Alice", email: "alice@example.com" })
      .returning("id")
      .executeTakeFirstOrThrow();

    // Queue welcome email - if user creation fails, no email job is created
    return client.createChain({
      db,
      transactionHooks,
      typeName: "send_welcome_email",
      input: { userId: user.id },
    });
  }),
);

// Wait for the chain to complete
const result = await client.awaitChain(chain, { timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);

// Cleanup
await stopWorker();
await notifyAdapter.close();
await stateAdapter.close();
await db.destroy();
