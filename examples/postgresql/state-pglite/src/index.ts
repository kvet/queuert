import { PGlite } from "@electric-sql/pglite";
import { createPgMigrator, createPgStateAdapter } from "@queuert/postgres";
import { createClient, createWorkerRunner, createProcessors, defineJobTypes } from "queuert";

import { createMigrations } from "./migrations.ts";
import { createPgliteStateProvider } from "./provider.ts";

await using drivers = new AsyncDisposableStack();
const pglite = drivers.adopt(await PGlite.create(), async (pglite) => pglite.close());

await pglite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL
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
const stateProvider = createPgliteStateProvider({ pglite });
await using stateAdapter = createPgStateAdapter({ stateProvider });
await stateAdapter.migrateToLatest();
// #endregion

const migrator = createPgMigrator({
  stateProvider,
  migrations: createMigrations({ pglite }),
});
const { applied } = await migrator.migrateToLatest();
console.log(`Applied app migrations: ${applied.join(", ")}`);
const invoices = await pglite.query("SELECT number, customer, status FROM invoices ORDER BY id");
console.log("Invoices:", invoices.rows);

const client = createClient({ stateAdapter, jobTypes });

await using workerRunner = createWorkerRunner({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      "send-welcome-email": {
        attemptHandler: async ({ job, applyJobOutcome }) => {
          const { rows } = await pglite.query<{ name: string; email: string }>(
            "SELECT name, email FROM users WHERE id = $1",
            [job.input.userId],
          );
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

const chain = await stateProvider.withTransaction(async (txCtx) => {
  const { rows } = await txCtx.pglite.query<{ id: number }>(
    "INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id",
    ["Alice", "alice@example.com"],
  );

  return client.createChain({
    ...txCtx,
    typeName: "send-welcome-email",
    input: { userId: rows[0].id },
  });
});

const result = await client.awaitChain({ chain, timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);
