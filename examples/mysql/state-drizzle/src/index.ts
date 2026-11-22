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

// Start MySQL using testcontainers
await using mysql = await acquireMysql("mysql:26", import.meta.url);

// Create database connection and schema
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

// Define job types
const jobTypes = defineJobTypes<{
  send_welcome_email: {
    entry: true;
    input: { userId: number };
    output: { sentAt: string };
  };
}>();

// Create state provider for Drizzle
// #region adapter
const stateProvider = createDrizzleMysqlStateProvider({ db });
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
        attemptHandler: async ({ job, applyOutcome }) => {
          const [user] = await db.select().from(users).where(eq(users.id, job.input.userId));
          if (!user) throw new Error(`User ${job.input.userId} not found`);

          // Simulate sending email (in real app, call email service here)
          console.log(`Sending welcome email to ${user.email} for ${user.name}`);

          return withTxHooks(async (txHooks) =>
            db.transaction(async (tx) =>
              applyOutcome({ tx, txHooks, output: { sentAt: new Date().toISOString() } }),
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
  db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ name: "Alice", email: "alice@example.com" })
      .$returningId();

    // Queue welcome email - if user creation fails, no email job is created
    return client.createChain({
      tx,
      txHooks,
      typeName: "send_welcome_email",
      input: { userId: user.id },
    });
  }),
);

// Wait for the chain to complete
const result = await client.awaitChain({ chain, timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);
