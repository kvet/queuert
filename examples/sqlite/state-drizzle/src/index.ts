import assert from "node:assert/strict";

import { createSqliteMigrator, createSqliteStateAdapter } from "@queuert/sqlite";
import Database from "better-sqlite3";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import {
  createClient,
  createWorkerRunner,
  createProcessors,
  defineJobTypes,
  withTxHooks,
} from "queuert";

import { createMigrations, invoices } from "./migrations.ts";
import { createDrizzleSqliteStateProvider } from "./provider.ts";

// Create in-memory SQLite database
using drivers = new DisposableStack();
const sqlite = drivers.adopt(new Database(":memory:"), (sqlite) => {
  sqlite.close();
});

// Define Drizzle schema
const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull(),
});

const schema = { users };

// Create Drizzle database connection
const db = drizzle(sqlite, { schema });

db.run(sql`
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

// Create state provider for Drizzle with better-sqlite3
// #region adapter
const stateProvider = createDrizzleSqliteStateProvider({ db: sqlite });
using stateAdapter = createSqliteStateAdapter({ stateProvider });
stateAdapter.migrateToLatest();
// #endregion

// Run the application's own migrations through the same provider
const migrator = createSqliteMigrator({
  stateProvider,
  migrations: createMigrations({ db }),
});
const { applied } = migrator.migrateToLatest();
console.log(`Applied application migrations: ${applied.join(", ")}`);
assert.deepEqual(
  db.select().from(invoices).orderBy(invoices.id).all(),
  [1, 2, 3, 4, 5].map((id) => ({ id, customer: `CUSTOMER-${id}`, status: "open" })),
);

const client = createClient({ stateAdapter, jobTypes });

await using workerRunner = createWorkerRunner({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      send_welcome_email: {
        attemptHandler: async ({ job, complete }) => {
          const user = db.select().from(users).where(eq(users.id, job.input.userId)).get();
          if (!user) throw new Error(`User ${job.input.userId} not found`);

          // Simulate sending email (in real app, call email service here)
          console.log(`Sending welcome email to ${user.email} for ${user.name}`);

          return withTxHooks((txHooks) =>
            db.transaction(() =>
              complete({ db: sqlite, txHooks, output: { sentAt: new Date().toISOString() } }),
            ),
          );
        },
      },
    },
  }),
});

// Start worker runner
await workerRunner.start();

// Register a new user and queue welcome email atomically
// #region create-chain
const chain = withTxHooks((txHooks) =>
  db.transaction((tx) => {
    // Use Drizzle to insert the user
    const [user] = tx
      .insert(users)
      .values({ name: "Alice", email: "alice@example.com" })
      .returning({ id: users.id })
      .all();

    // Queue welcome email - if user creation fails, no email job is created
    return client.createChain({
      db: sqlite,
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
