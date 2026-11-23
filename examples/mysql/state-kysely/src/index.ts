import { createMysqlMigrator, createMysqlStateAdapter } from "@queuert/mysql";
import { acquireMysql } from "@queuert/testcontainers";
import { CompiledQuery, Kysely, MysqlDialect } from "kysely";
import { createPool } from "mysql2";
import {
  createClient,
  createWorkerRunner,
  createProcessors,
  defineJobTypes,
  withTxHooks,
} from "queuert";

import type { Database } from "./database.ts";
import { createMigrations } from "./migrations.ts";
import { createKyselyMysqlStateProvider } from "./provider.ts";

// Start MySQL using testcontainers
await using mysql = await acquireMysql("mysql:26", import.meta.url);

// Create database connection and schema
await using db = new Kysely<Database>({
  dialect: new MysqlDialect({
    pool: createPool({ ...mysql.connectionOptions, connectionLimit: 10 }),
  }),
});

await db.executeQuery(
  CompiledQuery.raw(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL
    )
  `),
);

// Define job types
const jobTypes = defineJobTypes<{
  send_welcome_email: {
    entry: true;
    input: { userId: number };
    output: { sentAt: string };
  };
}>();

// Create state provider for Kysely
// #region adapter
const stateProvider = createKyselyMysqlStateProvider({ db });
await using stateAdapter = createMysqlStateAdapter({ stateProvider, dialect: "mysql" });
await stateAdapter.migrateToLatest();
// #endregion

// Run the application's own migrations with the same migrator
const { applied } = await createMysqlMigrator({
  stateProvider,
  migrations: createMigrations({ db }),
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
        attemptHandler: async ({ job, applyJobOutcome }) => {
          const user = await db
            .selectFrom("users")
            .selectAll()
            .where("id", "=", job.input.userId)
            .executeTakeFirstOrThrow();

          // Simulate sending email (in real app, call email service here)
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

// Register a new user and queue welcome email atomically
const chain = await withTxHooks(async (txHooks) =>
  db.transaction().execute(async (db) => {
    const { insertId } = await db
      .insertInto("users")
      .values({ name: "Alice", email: "alice@example.com" })
      .executeTakeFirstOrThrow();

    // Queue welcome email - if user creation fails, no email job is created
    return client.createChain({
      db,
      txHooks,
      typeName: "send_welcome_email",
      input: { userId: Number(insertId) },
    });
  }),
);

// Wait for the chain to complete
const result = await client.awaitChain({ chain, timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);
