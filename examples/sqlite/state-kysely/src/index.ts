import assert from "node:assert/strict";

import { createSqliteMigrator, createSqliteStateAdapter } from "@queuert/sqlite";
import BetterSqlite3 from "better-sqlite3";
import { type Generated, Kysely, SqliteDialect, sql } from "kysely";
import {
  createClient,
  createWorkerRunner,
  createProcessors,
  defineJobTypes,
  withTxHooks,
} from "queuert";

import { type InvoicesTable, createMigrations } from "./migrations.ts";
import { createKyselySqliteStateProvider } from "./provider.ts";

// Create in-memory SQLite database
const sqliteDb = new BetterSqlite3(":memory:");

// Define Kysely database schema
type Database = {
  users: { id: Generated<number>; name: string; email: string };
  invoices: InvoicesTable;
};

// Create Kysely database connection
await using db = new Kysely<Database>({
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
await using stateAdapter = createSqliteStateAdapter({
  stateProvider,
});
await stateAdapter.migrateToLatest();
// #endregion

const migrator = createSqliteMigrator({
  stateProvider,
  migrations: createMigrations({ db }),
});
const { applied } = await migrator.migrateToLatest();
console.log(`Applied application migrations: ${applied.join(", ")}`);
assert.deepEqual(
  await db.selectFrom("invoices").selectAll().orderBy("id").execute(),
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
          const user = await db
            .selectFrom("users")
            .selectAll()
            .where("id", "=", job.input.userId)
            .executeTakeFirstOrThrow();

          // Simulate sending email (in real app, call email service here)
          console.log(`Sending welcome email to ${user.email} for ${user.name}`);

          // Kysely holds its single SQLite connection for the whole transaction, so the
          // worker's own statements cannot run inside it.
          return withTxHooks(async (txHooks) =>
            db.transaction().execute(async (txDb) =>
              complete({
                db: txDb,
                txHooks,
                output: { sentAt: new Date().toISOString() },
              }),
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
  db.transaction().execute(async (txDb) => {
    const user = await txDb
      .insertInto("users")
      .values({ name: "Alice", email: "alice@example.com" })
      .returning("id")
      .executeTakeFirstOrThrow();

    // Queue welcome email - if user creation fails, no email job is created
    return client.createChain({
      db: txDb,
      txHooks,
      typeName: "send_welcome_email",
      input: { userId: user.id },
    });
  }),
);
// #endregion

// Wait for the chain to complete
const result = await client.awaitChain(chain, { timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);
