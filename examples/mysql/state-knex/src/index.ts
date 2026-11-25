import { createMysqlMigrator, createMysqlStateAdapter } from "@queuert/mysql";
import { acquireMysql } from "@queuert/testcontainers";
import knexFactory from "knex";
import {
  createClient,
  createWorkerRunner,
  createProcessors,
  defineJobTypes,
  withTxHooks,
} from "queuert";

import { createMigrations } from "./migrations.ts";
import { createKnexMysqlStateProvider } from "./provider.ts";

await using mysql = await acquireMysql("mysql:26", import.meta.url);

await using drivers = new AsyncDisposableStack();
const knex = drivers.adopt(
  knexFactory({
    client: "mysql2",
    connection: mysql.connectionOptions,
    pool: { min: 0, max: 10 },
  }),
  async (knex) => knex.destroy(),
);

await knex.raw(`
  CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL
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
const stateProvider = createKnexMysqlStateProvider({ knex });
await using stateAdapter = createMysqlStateAdapter({ stateProvider, dialect: "mysql" });
await stateAdapter.migrateToLatest();
// #endregion

const { applied } = await createMysqlMigrator({
  stateProvider,
  migrations: createMigrations({ db: knex }),
}).migrateToLatest();
console.log(`Applied app migrations: ${applied.join(", ")}`);

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
      const [userId] = await trx("users").insert({ name: "Alice", email: "alice@example.com" });

      return client.createChain({
        trx,
        txHooks,
        typeName: "send-welcome-email",
        input: { userId },
      });
    },
    { doNotRejectOnRollback: false },
  ),
);

const result = await client.awaitChain({ chain, timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);
