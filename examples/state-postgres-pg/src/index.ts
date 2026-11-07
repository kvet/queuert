import { createPgStateAdapter } from "@queuert/postgres";
import { acquirePostgres } from "@queuert/testcontainers";
import { Pool } from "pg";
import {
  createClient,
  createWorkerRunner,
  createProcessors,
  defineJobTypes,
  withTxHooks,
  createInProcessNotifyAdapter,
} from "queuert";

import { createPgPoolStateProvider } from "./provider.ts";

// Start PostgreSQL using testcontainers
await using pg = await acquirePostgres("postgres:18", import.meta.url);

// Create database connection and schema
const db = new Pool({
  connectionString: pg.connectionString,
  max: 10,
});

await db.query(`
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL
  );
`);

// Define job types
const jobTypes = defineJobTypes<{
  send_welcome_email: {
    entry: true;
    input: { userId: number };
    output: { sentAt: string };
  };
}>();

// Create state provider for pg
// #region adapter
const stateProvider = createPgPoolStateProvider({ pool: db });
const stateAdapter = createPgStateAdapter({
  stateProvider,
});
await stateAdapter.migrateToLatest();
// #endregion

const notifyAdapter = createInProcessNotifyAdapter();

const client = createClient({
  stateAdapter,
  notifyAdapter,
  jobTypes,
});

// Create and start worker runner
const workerRunner = createWorkerRunner({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      send_welcome_email: {
        attemptHandler: async ({ job, complete }) => {
          const { rows } = await db.query<{ id: number; name: string; email: string }>(
            "SELECT id, name, email FROM users WHERE id = $1",
            [job.input.userId],
          );
          const user = rows[0];
          if (!user) throw new Error(`User ${job.input.userId} not found`);

          // Simulate sending email (in real app, call email service here)
          console.log(`Sending welcome email to ${user.email} for ${user.name}`);

          return withTxHooks(async (txHooks) => {
            const poolClient = await db.connect();
            try {
              await poolClient.query("BEGIN");
              const result = await complete({
                poolClient,
                txHooks,
                output: { sentAt: new Date().toISOString() },
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
        },
      },
    },
  }),
});

const stopWorkerRunner = await workerRunner.start();

// Register a new user and queue welcome email atomically
const chain = await withTxHooks(async (txHooks) => {
  const poolClient = await db.connect();
  try {
    await poolClient.query("BEGIN");

    const userResult = await poolClient.query<{ id: number }>(
      "INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id",
      ["Alice", "alice@example.com"],
    );
    const user = userResult.rows[0];

    // Queue welcome email - if user creation fails, no email job is created
    const result = await client.createChain({
      poolClient,
      txHooks,
      typeName: "send_welcome_email",
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

// Wait for the chain to complete
const result = await client.awaitChain(chain, { timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);

// Cleanup
await stopWorkerRunner();
await notifyAdapter.close();
await stateAdapter.close();
await db.end();
