import { createPgStateAdapter, PgStateProvider } from "@queuert/postgres";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { PendingQuery, Row, TransactionSql as _TransactionSql } from "postgres";
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
const sql = postgres(pgContainer.getConnectionUri(), {
  max: 10,
});

await sql`
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL
  )
`;
await sql`
  CREATE TABLE IF NOT EXISTS pet (
    id SERIAL PRIMARY KEY,
    owner_id INTEGER REFERENCES users(id),
    name TEXT NOT NULL
  )
`;

// 3. Define job types
const jobTypeRegistry = defineJobTypes<{
  add_pet_to_user: {
    entry: true;
    input: { userId: number; petName: string };
    output: { petId: number };
  };
}>();

// 4. Create state provider for postgres.js
// TransactionSql loses its call signature due to TypeScript's Omit limitation.
// We restore it by intersecting with the tagged template call signature.
// See: https://github.com/microsoft/TypeScript/issues/41362
type TransactionSql = _TransactionSql & {
  <T extends readonly (object | undefined)[] = Row[]>(
    template: TemplateStringsArray,
    ...parameters: readonly postgres.ParameterOrFragment<never>[]
  ): PendingQuery<T>;
};

type DbContext = { sql: TransactionSql };

const stateProvider: PgStateProvider<DbContext> = {
  runInTransaction: async (cb) => {
    let result: any;
    await sql.begin(async (txSql) => {
      result = await cb({ sql: txSql as TransactionSql });
    });
    return result;
  },
  executeSql: async ({ txContext, sql: query, params }) => {
    const sqlClient = txContext?.sql ?? sql;
    const normalizedParams = params
      ? (params as any[]).map((p) => (p === undefined ? null : p))
      : [];
    const result = await sqlClient.unsafe(query, normalizedParams);
    return result as any;
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
        return complete(async ({ sql }) => {
          const [result] = await sql<{ id: number }[]>`
            INSERT INTO pet (owner_id, name)
            VALUES (${job.input.userId}, ${job.input.petName})
            RETURNING *
          `;
          return { petId: result.id };
        });
      },
    },
  },
});

const stopWorker = await qrtWorker.start();

// 7. Create a user and queue a job atomically in the same transaction
const jobChain = await qrtClient.withNotify(async () =>
  sql.begin(async (_sql) => {
    const txSql = _sql as TransactionSql;
    const [user] = await txSql<{ id: number }[]>`
      INSERT INTO users (name)
      VALUES ('Alice')
      RETURNING *
    `;

    return qrtClient.startJobChain({
      sql: txSql,
      typeName: "add_pet_to_user",
      input: { userId: user.id, petName: "Fluffy" },
    });
  }),
);

// 8. Wait for the job chain to complete
await qrtClient.waitForJobChainCompletion(jobChain, { timeoutMs: 1000 });

// 9. Cleanup
await stopWorker();
await sql.end();
await pgContainer.stop();
