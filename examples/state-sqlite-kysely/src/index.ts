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

// 2. Define Kysely database schema
type Database = {
  users: { id: Generated<number>; name: string; email: string };
};

// 3. Create Kysely database connection
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

// 4. Define job types
const jobTypes = defineJobTypes<{
  send_welcome_email: {
    entry: true;
    input: { userId: number };
    output: { sentAt: string };
  };
}>();

// 5. Create state provider for Kysely
const stateProvider = createKyselySqliteStateProvider({ db });

// 6. Create adapters and queuert client/worker
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

// 7. Create worker with job type processors
const worker = await createInProcessWorker({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      send_welcome_email: {
        attemptHandler: async ({ job, prepare, complete }) => {
          // Load the user with Kysely inside the job transaction
          const user = await prepare({ mode: "staged" }, async ({ db }) =>
            db
              .selectFrom("users")
              .selectAll()
              .where("id", "=", job.input.userId)
              .executeTakeFirstOrThrow(),
          );

          // Simulate sending email (in real app, call email service here)
          console.log(`Sending welcome email to ${user.email} for ${user.name}`);

          return complete(async ({ finish }) =>
            finish({ output: { sentAt: new Date().toISOString() } }),
          );
        },
      },
    },
  }),
});

const stopWorker = await worker.start();

// 8. Register a new user and queue welcome email atomically
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

// 9. Wait for the chain to complete
const result = await client.awaitChain(chain, { timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);

// 10. Cleanup
await stopWorker();
await notifyAdapter.close();
await stateAdapter.close();
sqliteDb.close();
