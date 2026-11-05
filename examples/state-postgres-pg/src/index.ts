import { createPgStateAdapter } from "@queuert/postgres";
import { acquirePostgres } from "@queuert/testcontainers";
import { Pool } from "pg";
import {
  createClient,
  createInProcessWorker,
  createProcessors,
  defineJobTypes,
  withTransactionHooks,
  createInProcessNotifyAdapter,
} from "queuert";

import { createPgPoolStateProvider } from "./provider.js";

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
const stateAdapter = await createPgStateAdapter({
  stateProvider,
});
await stateAdapter.migrateToLatest();
// #endregion

const notifyAdapter = await createInProcessNotifyAdapter();

const client = await createClient({
  stateAdapter,
  notifyAdapter,
  jobTypes,
});

// Create and start worker
const worker = await createInProcessWorker({
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

          return withTransactionHooks(async (transactionHooks) => {
            const poolClient = await db.connect();
            try {
              await poolClient.query("BEGIN");
              const result = await complete({
                poolClient,
                transactionHooks,
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

const stopWorker = await worker.start();

// Register a new user and queue welcome email atomically
const chain = await withTransactionHooks(async (transactionHooks) => {
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
      transactionHooks,
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
await stopWorker();
await notifyAdapter.close();
await stateAdapter.close();
await db.end();
