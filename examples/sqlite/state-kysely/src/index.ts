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

const sqliteDb = new BetterSqlite3(":memory:");

type Database = {
  users: { id: Generated<number>; name: string; email: string };
  invoices: InvoicesTable;
};

await using db = new Kysely<Database>({
  dialect: new SqliteDialect({
    database: sqliteDb,
  }),
});

await sql`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL
  )
`.execute(db);

const jobTypes = defineJobTypes<{
  "send-welcome-email": {
    entry: true;
    input: { userId: number };
    output: { sentAt: string };
  };
}>();

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

await using workerRunner = createWorkerRunner({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      "send-welcome-email": {
        attemptHandler: async ({ job, applyJobOutcome }) => {
          const user = await db
            .selectFrom("users")
            .selectAll()
            .where("id", "=", job.input.userId)
            .executeTakeFirstOrThrow();

          console.log(`Sending welcome email to ${user.email} for ${user.name}`);

          await withTxHooks(async (txHooks) =>
            db.transaction().execute(async (txDb) =>
              applyJobOutcome({
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

// #region create-chain
const chain = await withTxHooks(async (txHooks) =>
  db.transaction().execute(async (txDb) => {
    const user = await txDb
      .insertInto("users")
      .values({ name: "Alice", email: "alice@example.com" })
      .returning("id")
      .executeTakeFirstOrThrow();

    return client.createChain({
      db: txDb,
      txHooks,
      typeName: "send-welcome-email",
      input: { userId: user.id },
    });
  }),
);
// #endregion

const result = await client.awaitChain({ chain, timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);
