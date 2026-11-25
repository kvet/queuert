import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { createSqliteMigrator, createSqliteStateAdapter } from "@queuert/sqlite";
import {
  createClient,
  createWorkerRunner,
  createProcessors,
  defineJobTypes,
  withTxHooks,
} from "queuert";

import { createMigrations } from "./migrations.ts";
import { createNodeSqliteStateProvider } from "./provider.ts";

using db = new DatabaseSync(":memory:");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL
  );
`);

const jobTypes = defineJobTypes<{
  "send-welcome-email": {
    entry: true;
    input: { userId: number };
    output: { sentAt: string };
  };
}>();

// #region adapter
const stateProvider = createNodeSqliteStateProvider({ db });
using stateAdapter = createSqliteStateAdapter({ stateProvider });
stateAdapter.migrateToLatest();
// #endregion

const migrator = createSqliteMigrator({
  stateProvider,
  migrations: createMigrations({ db }),
});
const { applied } = migrator.migrateToLatest();
console.log(`Applied application migrations: ${applied.join(", ")}`);
const invoices = db.prepare("SELECT id, customer, status FROM invoices ORDER BY id").all();
assert.deepEqual(
  invoices.map((invoice) => ({ ...invoice })),
  [1, 2, 3, 4, 5].map((id) => ({ id, customer: `CUSTOMER-${id}`, status: "open" })),
);

const client = createClient({ stateAdapter, jobTypes });

await using workerRunner = createWorkerRunner({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      "send-welcome-email": {
        attemptHandler: async ({ job, applyJobOutcome }) => {
          const user = db
            .prepare("SELECT id, name, email FROM users WHERE id = ?")
            .get(job.input.userId) as { id: number; name: string; email: string } | undefined;
          if (!user) throw new Error(`User ${job.input.userId} not found`);

          console.log(`Sending welcome email to ${user.email} for ${user.name}`);

          withTxHooks((txHooks) => {
            db.exec("BEGIN");
            try {
              applyJobOutcome({
                db,
                txHooks,
                output: { sentAt: new Date().toISOString() },
              });
              db.exec("COMMIT");
            } catch (error) {
              if (db.isTransaction) db.exec("ROLLBACK");
              throw error;
            }
          });
        },
      },
    },
  }),
});

await workerRunner.start();

// #region create-chain
const chain = withTxHooks((txHooks) => {
  db.exec("BEGIN");
  try {
    const insertStmt = db.prepare("INSERT INTO users (name, email) VALUES (?, ?) RETURNING id");
    const user = insertStmt.get("Alice", "alice@example.com") as { id: number };

    const result = client.createChain({
      db,
      txHooks,
      typeName: "send-welcome-email",
      input: { userId: user.id },
    });

    db.exec("COMMIT");
    return result;
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
});
// #endregion

const result = await client.awaitChain({ chain, timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);
