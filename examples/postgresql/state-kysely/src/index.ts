import assert from "node:assert/strict";

import { createPgMigrator, createPgStateAdapter } from "@queuert/postgres";
import { acquirePostgres } from "@queuert/testcontainers";
import { CompiledQuery, Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import {
  createClient,
  createWorkerRunner,
  createProcessors,
  defineJobTypes,
  withTxHooks,
} from "queuert";

import type { Database } from "./database.ts";
import { createMigrations } from "./migrations.ts";
import { createKyselyPgStateProvider } from "./provider.ts";

await using pg = await acquirePostgres("postgres:18", import.meta.url);

await using db = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({
      connectionString: pg.connectionString,
      max: 10,
    }),
  }),
});

await db.executeQuery(
  CompiledQuery.raw(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL
    );
  `),
);

const jobTypes = defineJobTypes<{
  "send-welcome-email": {
    entry: true;
    input: { userId: number };
    output: { sentAt: string };
  };
}>();

// #region adapter
const stateProvider = createKyselyPgStateProvider({ db });
await using stateAdapter = createPgStateAdapter({
  stateProvider,
});
await stateAdapter.migrateToLatest();
// #endregion

const migrator = createPgMigrator({ stateProvider, migrations: createMigrations({ db }) });
const { applied } = await migrator.migrateToLatest();
console.log(`Applied application migrations: ${applied.join(", ")}`);

const openInvoices = await db
  .selectFrom("invoices")
  .select("customer")
  .where("status", "=", "open")
  .orderBy("id")
  .execute();
assert.deepEqual(
  openInvoices.map((invoice) => invoice.customer),
  ["ACME", "GLOBEX", "INITECH"],
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
            db
              .transaction()
              .execute(async (db) =>
                applyJobOutcome({ db, txHooks, output: { sentAt: new Date().toISOString() } }),
              ),
          );
        },
      },
    },
  }),
});

await workerRunner.start();

const chain = await withTxHooks(async (txHooks) =>
  db.transaction().execute(async (db) => {
    const user = await db
      .insertInto("users")
      .values({ name: "Alice", email: "alice@example.com" })
      .returning("id")
      .executeTakeFirstOrThrow();

    return client.createChain({
      db,
      txHooks,
      typeName: "send-welcome-email",
      input: { userId: user.id },
    });
  }),
);

const result = await client.awaitChain({ chain, timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);
