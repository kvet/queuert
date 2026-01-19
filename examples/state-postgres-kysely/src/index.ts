import { createPgStateAdapter, PgStateProvider } from "@queuert/postgres";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { CompiledQuery, Generated, Kysely, PostgresDialect } from "kysely";
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
interface Database {
  users: { id: Generated<number>; name: string };
  pet: { id: Generated<number>; owner_id: number; name: string };
}

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
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pet (
      id SERIAL PRIMARY KEY,
      owner_id INTEGER REFERENCES users(id),
      name TEXT NOT NULL
    );
  `),
);

// 4. Define job types
const jobTypeRegistry = defineJobTypes<{
  add_pet_to_user: {
    entry: true;
    input: { userId: number; petName: string };
    output: { petId: number };
  };
}>();

// 5. Create state provider for Kysely
type DbContext = { db: Kysely<Database> };

const stateProvider: PgStateProvider<DbContext> = {
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
  jobTypeRegistry,
});

// 7. Create qrtWorker with job type processors
const qrtWorker = await createQueuertInProcessWorker({
  stateAdapter,
  notifyAdapter,
  log,
  jobTypeRegistry,
  jobTypeProcessors: {
    add_pet_to_user: {
      process: async ({ job, complete }) => {
        return complete(async ({ db }) => {
          const result = await db
            .insertInto("pet")
            .values({
              owner_id: job.input.userId,
              name: job.input.petName,
            })
            .returningAll()
            .executeTakeFirstOrThrow();

          return { petId: result.id };
        });
      },
    },
  },
});

const stopWorker = await qrtWorker.start();

// 8. Create a user and queue a job atomically in the same transaction
const jobChain = await qrtClient.withNotify(async () =>
  db.transaction().execute(async (db) => {
    const user = await db
      .insertInto("users")
      .values({ name: "Alice" })
      .returningAll()
      .executeTakeFirstOrThrow();

    return qrtClient.startJobChain({
      db,
      typeName: "add_pet_to_user",
      input: { userId: user.id, petName: "Fluffy" },
    });
  }),
);

// 9. Wait for the job chain to complete
await qrtClient.waitForJobChainCompletion(jobChain, { timeoutMs: 1000 });

// 10. Cleanup
await stopWorker();
await db.destroy();
await pgContainer.stop();
