import { createMysqlMigrator, createMysqlStateAdapter } from "@queuert/mysql";
import { acquireMysql } from "@queuert/testcontainers";
import { SQL } from "bun";
import { createClient, createWorkerRunner, createProcessors, defineJobTypes } from "queuert";

import { createMigrations } from "./migrations.ts";
import { createBunSqlStateProvider } from "./provider.ts";

await using mysql = await acquireMysql("mysql:26", import.meta.url);

const { host, port, user, password, database } = mysql.connectionOptions;
await using sql = new SQL({
  adapter: "mysql",
  hostname: host,
  port,
  username: user,
  password,
  database,
  max: 10,
  allowPublicKeyRetrieval: true,
});

await sql`
  CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL
  )
`;

const jobTypes = defineJobTypes<{
  "send-welcome-email": {
    entry: true;
    input: { userId: number };
    output: { sentAt: string };
  };
}>();

// #region adapter
const stateProvider = createBunSqlStateProvider({ sql });
await using stateAdapter = createMysqlStateAdapter({ stateProvider, dialect: "mysql" });
await stateAdapter.migrateToLatest();
// #endregion

const { applied } = await createMysqlMigrator({
  stateProvider,
  migrations: createMigrations({ sql }),
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
          const [user]: { id: number; name: string; email: string }[] = await sql`
            SELECT id, name, email FROM users WHERE id = ${job.input.userId}
          `;
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

const chain = await stateProvider.withTransaction(async (txCtx) => {
  const { lastInsertRowid } = await txCtx.txSql`
    INSERT INTO users (name, email) VALUES (${"Alice"}, ${"alice@example.com"})
  `;

  return client.createChain({
    ...txCtx,
    typeName: "send-welcome-email",
    input: { userId: Number(lastInsertRowid) },
  });
});

const result = await client.awaitChain({ chain, timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);
