import assert from "node:assert/strict";

import { createSqliteMigrator, createSqliteStateAdapter } from "@queuert/sqlite";
import Database from "better-sqlite3";
import {
  createClient,
  createWorkerRunner,
  createProcessors,
  defineJobTypes,
  withTxHooks,
} from "queuert";

import { createMigrations } from "./migrations.ts";
import { createBetterSqlite3StateProvider } from "./provider.ts";

// Create in-memory SQLite database
using drivers = new DisposableStack();
const db = drivers.adopt(new Database(":memory:"), (db) => {
  db.close();
});

// Create application schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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

// Create providers and adapters
// #region adapter
const stateProvider = createBetterSqlite3StateProvider({ db });
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
  db.prepare("SELECT id, customer, status FROM invoices ORDER BY id").all(),
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
          const user = db
            .prepare("SELECT id, name, email FROM users WHERE id = ?")
            .get(job.input.userId) as { id: number; name: string; email: string } | undefined;
          if (!user) throw new Error(`User ${job.input.userId} not found`);

          // Simulate sending email (in real app, call email service here)
          console.log(`Sending welcome email to ${user.email} for ${user.name}`);

          return withTxHooks((txHooks) =>
            db.transaction(() =>
              complete({ db, txHooks, output: { sentAt: new Date().toISOString() } }),
            )(),
          );
        },
      },
    },
  }),
});

await workerRunner.start();

// Register a new user and queue welcome email atomically
// #region create-chain
const chain = withTxHooks((txHooks) =>
  db.transaction(() => {
    const user = db
      .prepare("INSERT INTO users (name, email) VALUES (?, ?) RETURNING id")
      .get("Alice", "alice@example.com") as { id: number };

    return client.createChain({
      db,
      txHooks,
      typeName: "send_welcome_email",
      input: { userId: user.id },
    });
  })(),
);
// #endregion

// Wait for the chain to complete
const result = await client.awaitChain(chain, { timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);
