import { type MigrationScript, createPgMigrator, createPgStateAdapter } from "@queuert/postgres";
import { acquirePostgres } from "@queuert/testcontainers";
import postgres from "postgres";
import {
  createClient,
  createWorkerRunner,
  createProcessors,
  defineJobTypes,
  withTxHooks,
} from "queuert";

import { createMigrations } from "./migrations.ts";
import { createPostgresJsStateProvider } from "./provider.ts";

// Start PostgreSQL using testcontainers
await using pg = await acquirePostgres("postgres:18", import.meta.url);

// Create database connection and schema
await using drivers = new AsyncDisposableStack();
const sql = drivers.adopt(postgres(pg.connectionString, { max: 10 }), async (sql) => sql.end());

await sql`
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL
  )
`;

// Define job types
const jobTypes = defineJobTypes<{
  send_welcome_email: {
    entry: true;
    input: { userId: number };
    output: { sentAt: string };
  };
}>();

// Create providers and adapters
// #region adapter
const stateProvider = createPostgresJsStateProvider({ sql });
await using stateAdapter = createPgStateAdapter({ stateProvider });
await stateAdapter.migrateToLatest();
// #endregion

// #region after
const after: MigrationScript = async ({ assertLockHeld }) => {
  assertLockHeld();
  await sql`CREATE TABLE IF NOT EXISTS migration_runs (id SERIAL PRIMARY KEY, finished_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
  await sql`INSERT INTO migration_runs DEFAULT VALUES`;
};
// #endregion

// #region lock
const lock = { ttlMs: 60_000, heartbeatIntervalMs: 15_000, pollIntervalMs: 1_000 };
// #endregion

// #region create-migrator
const migrations = createMigrations({ sql });
const migrator = createPgMigrator({
  stateProvider,
  migrations,
  lock,
  after,
});
// #endregion

// #region several-processes
const [first, second] = await Promise.all([
  migrator.migrateToLatest(),
  createPgMigrator({ stateProvider, migrations, lock, after }).migrateToLatest(),
]);
// #endregion
console.log(`Applied app migrations: ${[...first.applied, ...second.applied].join(", ")}`);
console.log(`Skipped app migrations: ${[...first.skipped, ...second.skipped].join(", ")}`);
const invoices = await sql`SELECT number, customer, status FROM invoices ORDER BY id`;
console.log("Invoices:", invoices);

const client = createClient({ stateAdapter, jobTypes });

await using workerRunner = createWorkerRunner({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      send_welcome_email: {
        attemptHandler: async ({ job, complete }) => {
          const [user] = await sql<{ id: number; name: string; email: string }[]>`
            SELECT id, name, email FROM users WHERE id = ${job.input.userId}
          `;
          if (!user) throw new Error(`User ${job.input.userId} not found`);

          // Simulate sending email (in real app, call email service here)
          console.log(`Sending welcome email to ${user.email} for ${user.name}`);

          return withTxHooks(async (txHooks) =>
            sql.begin(async (txSql) =>
              complete({ txSql, txHooks, output: { sentAt: new Date().toISOString() } }),
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
  sql.begin(async (txSql) => {
    const [user] = (await txSql.unsafe(
      "INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id",
      ["Alice", "alice@example.com"],
    )) as { id: number }[];

    return client.createChain({
      txSql,
      txHooks,
      typeName: "send_welcome_email",
      input: { userId: user.id },
    });
  }),
);

// Wait for the chain to complete
const result = await client.awaitChain({ chain, timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);

// #region revert
const { reverted } = await migrator.migrateTo("create_invoices");
// #endregion
console.log(`Reverted app migrations: ${reverted.join(", ")}`);
