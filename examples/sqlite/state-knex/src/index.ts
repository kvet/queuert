import assert from "node:assert/strict";

import { createSqliteMigrator, createSqliteStateAdapter } from "@queuert/sqlite";
import knexFactory from "knex";
import {
  createClient,
  createWorkerRunner,
  createProcessors,
  defineJobTypes,
  withTxHooks,
} from "queuert";

import { type Invoice, createMigrations } from "./migrations.ts";
import { createKnexSqliteStateProvider } from "./provider.ts";

await using drivers = new AsyncDisposableStack();
const knex = drivers.adopt(
  knexFactory({
    client: "better-sqlite3",
    connection: { filename: ":memory:" },
    useNullAsDefault: true,
  }),
  async (knex) => knex.destroy(),
);

await knex.raw(`
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
const stateProvider = createKnexSqliteStateProvider({ knex });
await using stateAdapter = createSqliteStateAdapter({
  stateProvider,
});
await stateAdapter.migrateToLatest();
// #endregion

const migrator = createSqliteMigrator({
  stateProvider,
  migrations: createMigrations({ db: knex }),
});
const { applied } = await migrator.migrateToLatest();
console.log(`Applied application migrations: ${applied.join(", ")}`);
assert.deepEqual(
  await knex<Invoice>("invoices").select().orderBy("id"),
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

// #region create-chain
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
// #endregion

const result = await client.awaitChain({ chain, timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);
