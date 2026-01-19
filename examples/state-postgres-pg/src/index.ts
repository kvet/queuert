import { createPgStateAdapter, PgStateProvider } from "@queuert/postgres";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool, PoolClient } from "pg";
import {
  createConsoleLog,
  createQueuertClient,
  createQueuertInProcessWorker,
  defineJobTypes,
} from "queuert";
import { createInProcessNotifyAdapter } from "queuert/internal";

// 1. Start PostgreSQL using testcontainers
const pgContainer = await new PostgreSqlContainer("postgres:14").withExposedPorts(5432).start();

// 2. Create database connection and schema
const db = new Pool({
  connectionString: pgContainer.getConnectionUri(),
  max: 10,
});

await db.query(`
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS pet (
    id SERIAL PRIMARY KEY,
    owner_id INTEGER REFERENCES users(id),
    name TEXT NOT NULL
  );
`);

// 3. Define job types
const jobTypeRegistry = defineJobTypes<{
  add_pet_to_user: {
    entry: true;
    input: { userId: number; petName: string };
    output: { petId: number };
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
const log = createConsoleLog();

const qrtClient = await createQueuertClient({
  stateAdapter,
  notifyAdapter,
  log,
  jobTypeRegistry,
});

// 6. Create and start qrtWorker
const qrtWorker = await createQueuertInProcessWorker({
  stateAdapter,
  notifyAdapter,
  log,
  jobTypeRegistry,
  jobTypeProcessors: {
    add_pet_to_user: {
      process: async ({ job, complete }) => {
        return complete(async ({ poolClient }) => {
          const result = await poolClient.query<{ id: number }>(
            "INSERT INTO pet (owner_id, name) VALUES ($1, $2) RETURNING *",
            [job.input.userId, job.input.petName],
          );
          return { petId: result.rows[0].id };
        });
      },
    },
  },
});

const stopWorker = await qrtWorker.start();

// 7. Create a user and queue a job atomically in the same transaction
const jobChain = await qrtClient.withNotify(async () => {
  const poolClient = await db.connect();
  try {
    await poolClient.query("BEGIN");

    const userResult = await poolClient.query<{ id: number }>(
      "INSERT INTO users (name) VALUES ($1) RETURNING *",
      ["Alice"],
    );
    const user = userResult.rows[0];

    const result = await qrtClient.startJobChain({
      poolClient,
      typeName: "add_pet_to_user",
      input: { userId: user.id, petName: "Fluffy" },
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
await qrtClient.waitForJobChainCompletion(jobChain, { timeoutMs: 1000 });

// 9. Cleanup
await stopWorker();
await db.end();
await pgContainer.stop();
