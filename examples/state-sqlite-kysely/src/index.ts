import { createSqliteStateAdapter } from "@queuert/sqlite";
import BetterSqlite3 from "better-sqlite3";
import { type Generated, Kysely, SqliteDialect, sql } from "kysely";
import {
  createClient,
  createInProcessNotifyAdapter,
  createInProcessWorker,
  createProcessors,
  defineJobTypes,
  withTransactionHooks,
} from "queuert";

import { createKyselySqliteStateProvider } from "./provider.js";

// Create in-memory SQLite database
const sqliteDb = new BetterSqlite3(":memory:");

// Define Kysely database schema
type Database = {
  users: { id: Generated<number>; name: string; email: string };
};

// Create Kysely database connection
const db = new Kysely<Database>({
  dialect: new SqliteDialect({
    database: sqliteDb,
  }),
});

// Create users table
await sql`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL
  )
`.execute(db);

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
const stateProvider = createKyselySqliteStateProvider({ db });
const stateAdapter = await createSqliteStateAdapter({
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

          // Kysely holds its single SQLite connection for the whole transaction, so the
          // worker's own statements cannot run inside it.
          return withTransactionHooks(async (transactionHooks) =>
            db.transaction().execute(async (txDb) =>
              complete({
                db: txDb,
                transactionHooks,
                output: { sentAt: new Date().toISOString() },
              }),
            ),
          );
        },
      },
    },
  }),
});

const stopWorker = await worker.start();

// Register a new user and queue welcome email atomically
// #region create-chain
const chain = await withTransactionHooks(async (transactionHooks) =>
  db.transaction().execute(async (txDb) => {
    const user = await txDb
      .insertInto("users")
      .values({ name: "Alice", email: "alice@example.com" })
      .returning("id")
      .executeTakeFirstOrThrow();

    // Queue welcome email - if user creation fails, no email job is created
    return client.createChain({
      db: txDb,
      transactionHooks,
      typeName: "send_welcome_email",
      input: { userId: user.id },
    });
  }),
);
// #endregion

// Wait for the chain to complete
const result = await client.awaitChain(chain, { timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);

// Cleanup
await stopWorker();
await notifyAdapter.close();
await stateAdapter.close();
sqliteDb.close();
