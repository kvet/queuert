import { type PgStateProvider, createPgStateAdapter } from "@queuert/postgres";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool, type PoolClient } from "pg";
import { createClient, createInProcessWorker, defineJobTypes } from "queuert";
import { createInProcessNotifyAdapter } from "queuert/internal";

// 1. Start PostgreSQL using testcontainers
const pgContainer = await new PostgreSqlContainer("postgres:18").withExposedPorts(5432).start();

// 2. Create database connection and schema
const db = new Pool({
  connectionString: pgContainer.getConnectionUri(),
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
const registry = defineJobTypes<{
  send_welcome_email: {
    entry: true;
    input: { userId: number; email: string; name: string };
    output: { sentAt: string };
  };
}>();

// 4. Create state provider for pg
type DbContext = { poolClient: PoolClient };

const stateProvider: PgStateProvider<DbContext> = {
  runInTransaction: async (cb) => {
    const poolClient = await db.connect();
    try {
      await poolClient.query("BEGIN");
      const result = await cb({ poolClient });
      await poolClient.query("COMMIT");
      return result;
    } catch (error) {
      await poolClient.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      poolClient.release();
    }
  },
  executeSql: async ({ txContext, sql, params }) => {
    if (txContext) {
      const result = await txContext.poolClient.query(sql, params);
      return result.rows;
    }
    const poolClient = await db.connect();
    try {
      const result = await poolClient.query(sql, params);
      return result.rows;
    } finally {
      poolClient.release();
    }
  },
};

// 5. Create adapters and queuert client/worker
const stateAdapter = await createPgStateAdapter({
  stateProvider,
  schema: "public",
});
await stateAdapter.migrateToLatest();

const notifyAdapter = createInProcessNotifyAdapter();

const qrtClient = await createClient({
  stateAdapter,
  notifyAdapter,
  registry,
});

// 6. Create and start qrtWorker
const qrtWorker = await createInProcessWorker({
  stateAdapter,
  notifyAdapter,
  registry,
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
});

const stopWorker = await qrtWorker.start();

// 7. Register a new user and queue welcome email atomically
const jobChain = await qrtClient.withNotify(async () => {
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
const result = await qrtClient.waitForJobChainCompletion(jobChain, { timeoutMs: 1000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);

// 9. Cleanup
await stopWorker();
await db.end();
await pgContainer.stop();
