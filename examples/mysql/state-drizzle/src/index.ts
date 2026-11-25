import { createMysqlMigrator, createMysqlStateAdapter } from "@queuert/mysql";
import { acquireMysql } from "@queuert/testcontainers";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { createPool } from "mysql2/promise";
import {
  createClient,
  createWorkerRunner,
  createProcessors,
  defineJobTypes,
  withTxHooks,
} from "queuert";

import { createMigrations } from "./migrations.ts";
import { createDrizzleMysqlStateProvider } from "./provider.ts";
import * as schema from "./schema.ts";
import { users } from "./schema.ts";

await using mysql = await acquireMysql("mysql:26", import.meta.url);

await using drivers = new AsyncDisposableStack();
const pool = drivers.adopt(
  createPool({ ...mysql.connectionOptions, connectionLimit: 10 }),
  async (pool) => pool.end(),
);

const db = drizzle(pool, { schema, mode: "default" });

await db.execute(sql`
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
const stateProvider = createDrizzleMysqlStateProvider({ db });
await using stateAdapter = createMysqlStateAdapter({ stateProvider, dialect: "mysql" });
await stateAdapter.migrateToLatest();
// #endregion

const { applied } = await createMysqlMigrator({
  stateProvider,
  migrations: createMigrations({ db }),
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
          const [user] = await db.select().from(users).where(eq(users.id, job.input.userId));
          if (!user) throw new Error(`User ${job.input.userId} not found`);

          console.log(`Sending welcome email to ${user.email} for ${user.name}`);

          await withTxHooks(async (txHooks) =>
            db.transaction(async (tx) =>
              applyJobOutcome({ tx, txHooks, output: { sentAt: new Date().toISOString() } }),
            ),
          );
        },
      },
    },
  }),
});

await workerRunner.start();

const chain = await withTxHooks(async (txHooks) =>
  db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ name: "Alice", email: "alice@example.com" })
      .$returningId();

    return client.createChain({
      tx,
      txHooks,
      typeName: "send-welcome-email",
      input: { userId: user.id },
    });
  }),
);

const result = await client.awaitChain({ chain, timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);
