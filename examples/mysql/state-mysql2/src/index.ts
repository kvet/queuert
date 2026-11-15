import { createMysqlMigrator, createMysqlStateAdapter } from "@queuert/mysql";
import { acquireMysql } from "@queuert/testcontainers";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { createPool } from "mysql2/promise";
import { createClient, createWorkerRunner, createProcessors, defineJobTypes } from "queuert";

import { createMigrations } from "./migrations.ts";
import { createMysql2PoolStateProvider } from "./provider.ts";

// Start MySQL using testcontainers
await using mysql = await acquireMysql("mysql:26", import.meta.url);

// Create database connection and schema
await using drivers = new AsyncDisposableStack();
const db = drivers.adopt(
  createPool({ ...mysql.connectionOptions, connectionLimit: 10 }),
  async (pool) => pool.end(),
);

await db.query(`
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

// Create state provider for mysql2
// #region adapter
const stateProvider = createMysql2PoolStateProvider({ pool: db });
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
        attemptHandler: async ({ job, complete }) => {
          const [rows] = await db.query<
            ({ id: number; name: string; email: string } & RowDataPacket)[]
          >("SELECT id, name, email FROM users WHERE id = ?", [job.input.userId]);
          const user = rows[0];
          if (!user) throw new Error(`User ${job.input.userId} not found`);

          // Simulate sending email (in real app, call email service here)
          console.log(`Sending welcome email to ${user.email} for ${user.name}`);

          return stateProvider.withTransaction(async (txCtx) =>
            complete({ ...txCtx, output: { sentAt: new Date().toISOString() } }),
          );
        },
      },
    },
  }),
});

await workerRunner.start();

// Register a new user and queue welcome email atomically
const chain = await stateProvider.withTransaction(async (txCtx) => {
  const [insert] = await txCtx.connection.query<ResultSetHeader>(
    "INSERT INTO users (name, email) VALUES (?, ?)",
    ["Alice", "alice@example.com"],
  );

  // Queue welcome email - if user creation fails, no email job is created
  return client.createChain({
    ...txCtx,
    typeName: "send_welcome_email",
    input: { userId: insert.insertId },
  });
});

// Wait for the chain to complete
const result = await client.awaitChain(chain, { timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);
