import { type PgStateProvider, createPgStateAdapter } from "@queuert/postgres";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { CompiledQuery, type Generated, Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import {
  createConsoleLog,
  createQueuertClient,
  createQueuertInProcessWorker,
  defineJobTypes,
} from "queuert";
import { createInProcessNotifyAdapter } from "queuert/internal";

// 1. Start PostgreSQL using testcontainers
const pgContainer = await new PostgreSqlContainer("postgres:14").withExposedPorts(5432).start();

// 2. Define Kysely database schema
type Database = {
  users: { id: Generated<number>; name: string; email: string };
};

// 3. Create database connection and schema
const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({
      connectionString: pgContainer.getConnectionUri(),
      max: 10,
    }),
  }),
});

await db.executeQuery(
  CompiledQuery.raw(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL
    );
  `),
);

// 4. Define job types
const registry = defineJobTypes<{
  send_welcome_email: {
    entry: true;
    input: { userId: number; email: string; name: string };
    output: { sentAt: string };
  };
}>();

// 5. Create state provider for Kysely
const stateProvider: PgStateProvider<{ db: Kysely<Database> }> = {
  runInTransaction: async (cb) => db.transaction().execute(async (txDb) => cb({ db: txDb })),
  executeSql: async ({ txContext, sql, params }) => {
    if (txContext && !txContext.db.isTransaction) {
      throw new Error("Provided context is not in a transaction");
    }
    const result = await (txContext?.db ?? db).executeQuery(CompiledQuery.raw(sql, params));
    return result.rows;
  },
};

// 6. Create adapters and queuert client/worker
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
  registry,
});

// 7. Create qrtWorker with job type processors
const qrtWorker = await createQueuertInProcessWorker({
  stateAdapter,
  notifyAdapter,
  log,
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

// 8. Register a new user and queue welcome email atomically
const jobChain = await qrtClient.withNotify(async () =>
  db.transaction().execute(async (db) => {
    const user = await db
      .insertInto("users")
      .values({ name: "Alice", email: "alice@example.com" })
      .returningAll()
      .executeTakeFirstOrThrow();

    // Queue welcome email - if user creation fails, no email job is created
    return qrtClient.startJobChain({
      db,
      typeName: "send_welcome_email",
      input: { userId: user.id, email: user.email, name: user.name },
    });
  }),
);

// 9. Wait for the job chain to complete
const result = await qrtClient.waitForJobChainCompletion(jobChain, { timeoutMs: 1000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);

// 10. Cleanup
await stopWorker();
await db.destroy();
await pgContainer.stop();
