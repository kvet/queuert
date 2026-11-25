import { Database } from "bun:sqlite";
import assert from "node:assert/strict";

import { createSqliteMigrator, createSqliteStateAdapter } from "@queuert/sqlite";
import {
  createClient,
  createWorkerRunner,
  createProcessors,
  defineJobTypes,
  withTxHooks,
} from "queuert";

import { createMigrations } from "./migrations.ts";
import { createBunSqliteStateProvider } from "./provider.ts";

using db = new Database(":memory:");

db.run(`
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
const stateProvider = createBunSqliteStateProvider({ db });
using stateAdapter = createSqliteStateAdapter({ stateProvider });
stateAdapter.migrateToLatest();
// #endregion

const migrator = createSqliteMigrator({
  stateProvider,
  migrations: createMigrations({ db }),
});
const { applied } = migrator.migrateToLatest();
console.log(`Applied application migrations: ${applied.join(", ")}`);
assert.deepEqual(
  db.query("SELECT id, customer, status FROM invoices ORDER BY id").all(),
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
            .query<{ id: number; name: string; email: string }, [number]>(
              "SELECT id, name, email FROM users WHERE id = ?",
            )
            .get(job.input.userId);
          if (!user) throw new Error(`User ${job.input.userId} not found`);

          console.log(`Sending welcome email to ${user.email} for ${user.name}`);

          withTxHooks((txHooks) =>
            db.transaction(() =>
              applyJobOutcome({ db, txHooks, output: { sentAt: new Date().toISOString() } }),
            )(),
          );
        },
      },
    },
  }),
});

await workerRunner.start();

// #region create-chain
const chain = withTxHooks((txHooks) =>
  db.transaction(() => {
    const user = db
      .query<{ id: number }, [string, string]>(
        "INSERT INTO users (name, email) VALUES (?, ?) RETURNING id",
      )
      .get("Alice", "alice@example.com");
    if (!user) throw new Error("Failed to insert user");

    return client.createChain({
      db,
      txHooks,
      typeName: "send-welcome-email",
      input: { userId: user.id },
    });
  })(),
);
// #endregion

const result = await client.awaitChain({ chain, timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);
