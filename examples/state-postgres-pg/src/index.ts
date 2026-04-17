import { createPgStateAdapter } from "@queuert/postgres";
import { acquirePostgres } from "@queuert/testcontainers";
import { Pool } from "pg";
import {
  createClient,
  createInProcessWorker,
  createJobTypeProcessorRegistry,
  defineJobTypeRegistry,
  withTransactionHooks,
} from "queuert";
import { createInProcessNotifyAdapter } from "queuert/internal";

import { createPgPoolStateProvider } from "./provider.js";

// 1. Start PostgreSQL using testcontainers
await using pg = await acquirePostgres("postgres:18", import.meta.url);

// 2. Create database connection and schema
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

// 3. Define job types
const jobTypeRegistry = defineJobTypeRegistry<{
  send_welcome_email: {
    entry: true;
    input: { userId: number; email: string; name: string };
    output: { sentAt: string };
  };
}>();

// 4. Create state provider for pg
const stateProvider = createPgPoolStateProvider({ pool: db });

// 5. Create adapters and queuert client/worker
const stateAdapter = await createPgStateAdapter({
  stateProvider,
});
await stateAdapter.migrateToLatest();

const notifyAdapter = createInProcessNotifyAdapter();

const qrtClient = await createClient({
  stateAdapter,
  notifyAdapter,
  jobTypeRegistry,
});

// 6. Create and start qrtWorker
const qrtWorker = await createInProcessWorker({
  client: qrtClient,
  jobTypeProcessorRegistry: createJobTypeProcessorRegistry({
    client: qrtClient,
    jobTypeRegistry,
    processors: {
      send_welcome_email: {
        attemptHandler: async ({ job, complete }) => {
          // Simulate sending email (in real app, call email service here)
          console.log(`Sending welcome email to ${job.input.email} for ${job.input.name}`);

          return complete(async () => ({
            sentAt: new Date().toISOString(),
          }));
        },
      },
    },
  }),
});

const stopWorker = await qrtWorker.start();

// 7. Register a new user and queue welcome email atomically
const jobChain = await withTransactionHooks(async (transactionHooks) => {
  const poolClient = await db.connect();
  try {
    await poolClient.query("BEGIN");

    const userResult = await poolClient.query<{ id: number; name: string; email: string }>(
      "INSERT INTO users (name, email) VALUES ($1, $2) RETURNING *",
      ["Alice", "alice@example.com"],
    );
    const user = userResult.rows[0];

    // Queue welcome email - if user creation fails, no email job is created
    const result = await qrtClient.startJobChain({
      poolClient,
      transactionHooks,
      typeName: "send_welcome_email",
      input: { userId: user.id, email: user.email, name: user.name },
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

// 8. Wait for the job chain to complete
const result = await qrtClient.awaitJobChain(jobChain, { timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);

// 9. Cleanup
await stopWorker();
await db.end();
