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

// 1. Create in-memory SQLite database
const sqliteDb = new BetterSqlite3(":memory:");

// 2. Configure SQLite pragmas
sqliteDb.pragma("auto_vacuum = INCREMENTAL");
sqliteDb.pragma("foreign_keys = ON");

// 3. Define Kysely database schema
type Database = {
  users: { id: Generated<number>; name: string; email: string };
};

// 4. Create Kysely database connection
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

// 5. Define job types
const jobTypes = defineJobTypes<{
  send_welcome_email: {
    entry: true;
    input: { userId: number; email: string; name: string };
    output: { sentAt: string };
  };
}>();

// 6. Create state provider for Kysely
const stateProvider = createKyselySqliteStateProvider({ db });

// 7. Create adapters and queuert client/worker
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

// 8. Create worker with job type processors
const worker = await createInProcessWorker({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      send_welcome_email: {
        attemptHandler: async ({ job, complete }) => {
          // Simulate sending email (in real app, call email service here)
          console.log(`Sending welcome email to ${job.input.email} for ${job.input.name}`);

          return complete(async () => ({
            sentAt: new Date().toISOString(),
          }));
        },
      },
    },
  }),
});

const stopWorker = await worker.start();

// 9. Register a new user and queue welcome email atomically
const jobChain = await withTransactionHooks(async (transactionHooks) =>
  db.transaction().execute(async (txDb) => {
    const user = await txDb
      .insertInto("users")
      .values({ name: "Alice", email: "alice@example.com" })
      .returningAll()
      .executeTakeFirstOrThrow();

    // Queue welcome email - if user creation fails, no email job is created
    return client.startJobChain({
      db: txDb,
      transactionHooks,
      typeName: "send_welcome_email",
      input: { userId: user.id, email: user.email, name: user.name },
    });
  }),
);

// 10. Wait for the job chain to complete
const result = await client.awaitJobChain(jobChain, { timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);

// 11. Cleanup
await stopWorker();
sqliteDb.close();
