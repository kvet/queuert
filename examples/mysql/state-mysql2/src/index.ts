import { createMysqlMigrator, createMysqlStateAdapter } from "@queuert/mysql";
import { acquireMysql } from "@queuert/testcontainers";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { createPool } from "mysql2/promise";
import { createClient, createWorkerRunner, createProcessors, defineJobTypes } from "queuert";

import { createMigrations } from "./migrations.ts";
import { createMysql2PoolStateProvider } from "./provider.ts";

await using mysql = await acquireMysql("mysql:26", import.meta.url);

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

const jobTypes = defineJobTypes<{
  "send-welcome-email": {
    entry: true;
    input: { userId: number };
    output: { sentAt: string };
  };
}>();

// #region adapter
const stateProvider = createMysql2PoolStateProvider({ pool: db });
await using stateAdapter = createMysqlStateAdapter({ stateProvider, dialect: "mysql" });
await stateAdapter.migrateToLatest();
// #endregion

const { applied } = await createMysqlMigrator({
  stateProvider,
  migrations: createMigrations({ db }),
}).migrateToLatest();
console.log(`Applied app migrations: ${applied.join(", ")}`);

// #region process
const client = createClient({ stateAdapter, jobTypes });

await using workerRunner = createWorkerRunner({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      "send-welcome-email": {
        attemptHandler: async ({ job, applyJobOutcome }) => {
          const [rows] = await db.query<
            ({ id: number; name: string; email: string } & RowDataPacket)[]
          >("SELECT id, name, email FROM users WHERE id = ?", [job.input.userId]);
          const user = rows[0];
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
// #endregion

// #region create-chain
const chain = await stateProvider.withTransaction(async (txCtx) => {
  const [insert] = await txCtx.connection.query<ResultSetHeader>(
    "INSERT INTO users (name, email) VALUES (?, ?)",
    ["Alice", "alice@example.com"],
  );

  return client.createChain({
    ...txCtx,
    typeName: "send-welcome-email",
    input: { userId: insert.insertId },
  });
});
// #endregion

const result = await client.awaitChain({ chain, timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);
