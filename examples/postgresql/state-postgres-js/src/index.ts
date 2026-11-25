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

await using pg = await acquirePostgres("postgres:18", import.meta.url);

await using drivers = new AsyncDisposableStack();
const sql = drivers.adopt(postgres(pg.connectionString, { max: 10 }), async (sql) => sql.end());

await sql`
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL
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
      "send-welcome-email": {
        attemptHandler: async ({ job, applyJobOutcome }) => {
          const [user] = await sql<{ id: number; name: string; email: string }[]>`
            SELECT id, name, email FROM users WHERE id = ${job.input.userId}
          `;
          if (!user) throw new Error(`User ${job.input.userId} not found`);

          console.log(`Sending welcome email to ${user.email} for ${user.name}`);

          await withTxHooks(async (txHooks) =>
            sql.begin(async (txSql) =>
              applyJobOutcome({ txSql, txHooks, output: { sentAt: new Date().toISOString() } }),
            ),
          );
        },
      },
    },
  }),
});

await workerRunner.start();

const chain = await withTxHooks(async (txHooks) =>
  sql.begin(async (txSql) => {
    const [user] = (await txSql.unsafe(
      "INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id",
      ["Alice", "alice@example.com"],
    )) as { id: number }[];

    return client.createChain({
      txSql,
      txHooks,
      typeName: "send-welcome-email",
      input: { userId: user.id },
    });
  }),
);

const result = await client.awaitChain({ chain, timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);

// #region revert
const { reverted } = await migrator.migrateTo("create_invoices");
// #endregion
console.log(`Reverted app migrations: ${reverted.join(", ")}`);
