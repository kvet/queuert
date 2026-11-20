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

// Start MySQL using testcontainers
await using mysql = await acquireMysql("mysql:26", import.meta.url);

// Create database connection
await using drivers = new AsyncDisposableStack();
const knex = drivers.adopt(
  knexFactory({
    client: "mysql2",
    connection: mysql.connectionOptions,
    pool: { min: 0, max: 10 },
  }),
  async (knex) => knex.destroy(),
);

// Create application schema
await knex.raw(`
  CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL
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

// Create state provider for Knex
// #region adapter
const stateProvider = createKnexMysqlStateProvider({ knex });
await using stateAdapter = createMysqlStateAdapter({ stateProvider, dialect: "mysql" });
await stateAdapter.migrateToLatest();
// #endregion

// Run the application's own migrations with the same migrator
const { applied } = await createMysqlMigrator({
  stateProvider,
  migrations: createMigrations({ db: knex }),
}).migrateToLatest();
console.log(`Applied app migrations: ${applied.join(", ")}`);

const client = createClient({ stateAdapter, jobTypes });

// Create and start worker runner
await using workerRunner = createWorkerRunner({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      send_welcome_email: {
        attemptHandler: async ({ job, complete }) => {
          const user = await knex<{ id: number; name: string; email: string }>("users")
            .where({ id: job.input.userId })
            .first();
          if (!user) throw new Error(`User ${job.input.userId} not found`);

          // Simulate sending email (in real app, call email service here)
          console.log(`Sending welcome email to ${user.email} for ${user.name}`);

          return withTxHooks(async (txHooks) =>
            knex.transaction(
              async (trx) =>
                complete({ trx, txHooks, output: { sentAt: new Date().toISOString() } }),
              { doNotRejectOnRollback: false },
            ),
          );
        },
      },
    },
  }),
});

await workerRunner.start();

// Register a new user and queue welcome email atomically
const chain = await withTxHooks(async (txHooks) =>
  knex.transaction(
    async (trx) => {
      const [userId] = await trx("users").insert({ name: "Alice", email: "alice@example.com" });

      // Queue welcome email - if user creation fails, no email job is created
      return client.createChain({
        trx,
        txHooks,
        typeName: "send_welcome_email",
        input: { userId },
      });
    },
    { doNotRejectOnRollback: false },
  ),
);

// Wait for the chain to complete
const result = await client.awaitChain(chain, { timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);
