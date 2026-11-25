import { createPgMigrator, createPgStateAdapter } from "@queuert/postgres";
import { acquirePostgres } from "@queuert/testcontainers";
import { Pool } from "pg";
import {
  createClient,
  createWorkerRunner,
  createProcessors,
  defineJobTypes,
  withTxHooks,
} from "queuert";

import { createMigrations } from "./migrations.ts";
import { createPgPoolStateProvider } from "./provider.ts";

await using pg = await acquirePostgres("postgres:18", import.meta.url);

await using drivers = new AsyncDisposableStack();
const db = drivers.adopt(
  new Pool({ connectionString: pg.connectionString, max: 10 }),
  async (pool) => pool.end(),
);

await db.query(`
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL
  );
`);

const jobTypes = defineJobTypes<{
  "send-welcome-email": {
    entry: true;
    input: { userId: number };
    output: { sentAt: string };
  };
}>();

// #region adapter
const stateProvider = createPgPoolStateProvider({ pool: db });
await using stateAdapter = createPgStateAdapter({
  stateProvider,
});
await stateAdapter.migrateToLatest();
// #endregion

const { applied } = await createPgMigrator({
  stateProvider,
  migrations: createMigrations({ db }),
}).migrateToLatest();
console.log(`Applied app migrations: ${applied.join(", ")}`);
const { rows: invoices } = await db.query(
  "SELECT number, customer, status FROM invoices ORDER BY id",
);
console.log("Invoices:", invoices);

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
          const { rows } = await db.query<{ id: number; name: string; email: string }>(
            "SELECT id, name, email FROM users WHERE id = $1",
            [job.input.userId],
          );
          const user = rows[0];
          if (!user) throw new Error(`User ${job.input.userId} not found`);

          console.log(`Sending welcome email to ${user.email} for ${user.name}`);

          await withTxHooks(async (txHooks) => {
            const poolClient = await db.connect();
            try {
              await poolClient.query("BEGIN");
              await applyJobOutcome({
                poolClient,
                txHooks,
                output: { sentAt: new Date().toISOString() },
              });
              await poolClient.query("COMMIT");
            } catch (error) {
              await poolClient.query("ROLLBACK").catch(() => {});
              throw error;
            } finally {
              poolClient.release();
            }
          });
        },
      },
    },
  }),
});

await workerRunner.start();
// #endregion

// #region create-chain
const chain = await withTxHooks(async (txHooks) => {
  const poolClient = await db.connect();
  try {
    await poolClient.query("BEGIN");

    const userResult = await poolClient.query<{ id: number }>(
      "INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id",
      ["Alice", "alice@example.com"],
    );
    const user = userResult.rows[0];

    const result = await client.createChain({
      poolClient,
      txHooks,
      typeName: "send-welcome-email",
      input: { userId: user.id },
    });

    await poolClient.query("COMMIT");
    return result;
  } catch (error) {
    await poolClient.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    poolClient.release();
  }
});
// #endregion

const result = await client.awaitChain({ chain, timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);
