import assert from "node:assert/strict";

import { createAsyncRwLock, createSqliteMigrator, createSqliteStateAdapter } from "@queuert/sqlite";
import { createClient, createWorkerRunner, createProcessors, defineJobTypes } from "queuert";
import initSqlJs from "sql.js";

import { createMigrations } from "./migrations.ts";
import { createSqlJsStateProvider } from "./provider.ts";

const SQL = await initSqlJs();
using drivers = new DisposableStack();
const db = drivers.adopt(new SQL.Database(), (db) => {
  db.close();
});

db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL
  )
`);

const jobTypes = defineJobTypes<{
  "send-welcome-email": {
    entry: true;
    input: { userId: number };
    output: { sentAt: string };
  };
}>();

// #region adapter
const lock = createAsyncRwLock();
const stateProvider = createSqlJsStateProvider({ db, lock });
await using stateAdapter = createSqliteStateAdapter({ stateProvider });
await stateAdapter.migrateToLatest();
// #endregion

const migrator = createSqliteMigrator({
  stateProvider,
  migrations: createMigrations({ db, lock }),
});
const { applied } = await migrator.migrateToLatest();
console.log(`Applied application migrations: ${applied.join(", ")}`);
{
  using _h = await lock.acquireRead();
  assert.deepEqual(
    db.exec("SELECT id, customer, status FROM invoices ORDER BY id")[0]?.values,
    [1, 2, 3, 4, 5].map((id) => [id, `CUSTOMER-${id}`, "open"]),
  );
}

const client = createClient({ stateAdapter, jobTypes });

await using workerRunner = createWorkerRunner({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      "send-welcome-email": {
        attemptHandler: async ({ job, applyJobOutcome }) => {
          let user: { name: string; email: string } | undefined;
          {
            using _h = await lock.acquireRead();
            const statement = db.prepare("SELECT name, email FROM users WHERE id = ?");
            statement.bind([job.input.userId]);
            if (statement.step()) user = statement.getAsObject() as typeof user;
            statement.free();
          }
          if (!user) throw new Error(`User ${job.input.userId} not found`);

          console.log(`Sending welcome email to ${user.email} for ${user.name}`);

          await stateProvider.withTransaction(async (txCtx) =>
            applyJobOutcome({ ...txCtx, output: { sentAt: new Date().toISOString() } }),
          );
        },
      },
    },
  }),
});

await workerRunner.start();

// #region create-chain
const chain = await stateProvider.withTransaction(async (txCtx) => {
  txCtx.db.run("INSERT INTO users (name, email) VALUES (?, ?)", ["Alice", "alice@example.com"]);
  const userId = txCtx.db.exec("SELECT last_insert_rowid()")[0].values[0][0] as number;

  return client.createChain({
    ...txCtx,
    typeName: "send-welcome-email",
    input: { userId },
  });
});
// #endregion

const result = await client.awaitChain({ chain, timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);
