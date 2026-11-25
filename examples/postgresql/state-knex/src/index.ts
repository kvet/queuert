import assert from "node:assert/strict";

import { createPgMigrator, createPgStateAdapter } from "@queuert/postgres";
import { acquirePostgres } from "@queuert/testcontainers";
import knexFactory from "knex";
import {
  createClient,
  createWorkerRunner,
  createProcessors,
  defineJobTypes,
  withTxHooks,
} from "queuert";

import { type Invoice, createMigrations } from "./migrations.ts";
import { createKnexPgStateProvider } from "./provider.ts";

await using pg = await acquirePostgres("postgres:18", import.meta.url);

await using drivers = new AsyncDisposableStack();
const knex = drivers.adopt(
  knexFactory({
    client: "pg",
    connection: pg.connectionString,
    pool: { min: 0, max: 10 },
  }),
  async (knex) => knex.destroy(),
);

await knex.raw(`
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
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
const stateProvider = createKnexPgStateProvider({ knex });
await using stateAdapter = createPgStateAdapter({
  stateProvider,
});
await stateAdapter.migrateToLatest();
// #endregion

const migrator = createPgMigrator({ stateProvider, migrations: createMigrations({ db: knex }) });
const { applied } = await migrator.migrateToLatest();
console.log(`Applied application migrations: ${applied.join(", ")}`);

const openInvoices = await knex<Invoice>("invoices").where({ status: "open" }).orderBy("id");
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
          const user = await knex<{ id: number; name: string; email: string }>("users")
            .where({ id: job.input.userId })
            .first();
          if (!user) throw new Error(`User ${job.input.userId} not found`);

          console.log(`Sending welcome email to ${user.email} for ${user.name}`);

          await withTxHooks(async (txHooks) =>
            knex.transaction(
              async (trx) =>
                applyJobOutcome({ trx, txHooks, output: { sentAt: new Date().toISOString() } }),
              { doNotRejectOnRollback: false },
            ),
          );
        },
      },
    },
  }),
});

await workerRunner.start();

const chain = await withTxHooks(async (txHooks) =>
  knex.transaction(
    async (trx) => {
      const [user] = await trx<{ id: number; name: string; email: string }>("users")
        .insert({ name: "Alice", email: "alice@example.com" })
        .returning(["id"]);

      return client.createChain({
        trx,
        txHooks,
        typeName: "send-welcome-email",
        input: { userId: user.id },
      });
    },
    { doNotRejectOnRollback: false },
  ),
);

const result = await client.awaitChain({ chain, timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);
