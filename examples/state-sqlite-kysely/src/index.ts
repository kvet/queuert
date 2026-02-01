import {
  type SqliteStateProvider,
  createAsyncLock,
  createSqliteStateAdapter,
} from "@queuert/sqlite";
import BetterSqlite3 from "better-sqlite3";
import { CompiledQuery, type Generated, Kysely, SqliteDialect, sql } from "kysely";
import { createClient, createInProcessWorker, defineJobTypes } from "queuert";
import { createInProcessNotifyAdapter } from "queuert/internal";

// 1. Create in-memory SQLite database
const sqliteDb = new BetterSqlite3(":memory:");

// 2. Configure SQLite pragmas
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
const registry = defineJobTypes<{
  send_welcome_email: {
    entry: true;
    input: { userId: number; email: string; name: string };
    output: { sentAt: string };
  };
}>();

// 6. Create state provider for Kysely with write serialization
const lock = createAsyncLock();

const stateProvider: SqliteStateProvider<{ db: Kysely<Database> }> = {
  runInTransaction: async (cb) => {
    await lock.acquire();
    try {
      return await db.transaction().execute(async (txDb) => cb({ db: txDb }));
    } finally {
      lock.release();
    }
  },
  executeSql: async ({ txContext, sql: sqlStr, params, returns }) => {
    const database = txContext?.db ?? db;
    const result = await database.executeQuery(CompiledQuery.raw(sqlStr, params));
    return returns ? result.rows : [];
  },
};

// 7. Create adapters and queuert client/worker
const stateAdapter = await createSqliteStateAdapter({
  stateProvider,
});
await stateAdapter.migrateToLatest();

const notifyAdapter = createInProcessNotifyAdapter();

const qrtClient = await createClient({
  stateAdapter,
  notifyAdapter,
  registry,
});

// 8. Create qrtWorker with job type processors
const qrtWorker = await createInProcessWorker({
  stateAdapter,
  notifyAdapter,
  registry,
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
});

const stopWorker = await qrtWorker.start();

// 9. Register a new user and queue welcome email atomically
const jobChain = await qrtClient.withNotify(async () =>
  db.transaction().execute(async (txDb) => {
    const user = await txDb
      .insertInto("users")
      .values({ name: "Alice", email: "alice@example.com" })
      .returningAll()
      .executeTakeFirstOrThrow();

    // Queue welcome email - if user creation fails, no email job is created
    return qrtClient.startJobChain({
      db: txDb,
      typeName: "send_welcome_email",
      input: { userId: user.id, email: user.email, name: user.name },
    });
  }),
);

// 10. Wait for the job chain to complete
const result = await qrtClient.waitForJobChainCompletion(jobChain, { timeoutMs: 1000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);

// 11. Cleanup
await stopWorker();
sqliteDb.close();
