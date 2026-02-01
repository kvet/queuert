import { type PgStateProvider, createPgStateAdapter } from "@queuert/postgres";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, {
  type PendingQuery,
  type Row,
  type TransactionSql as _TransactionSql,
} from "postgres";
import { createClient, createInProcessWorker, defineJobTypes } from "queuert";
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
    name TEXT NOT NULL,
    email TEXT NOT NULL
  )
`;

// 3. Define job types
const registry = defineJobTypes<{
  send_welcome_email: {
    entry: true;
    input: { userId: number; email: string; name: string };
    output: { sentAt: string };
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
const jobChain = await qrtClient.withNotify(async () =>
  sql.begin(async (_sql) => {
    const txSql = _sql as TransactionSql;
    const [user] = await txSql<{ id: number; name: string; email: string }[]>`
      INSERT INTO users (name, email)
      VALUES ('Alice', 'alice@example.com')
      RETURNING *
    `;

    // Queue welcome email - if user creation fails, no email job is created
    return qrtClient.startJobChain({
      sql: txSql,
      typeName: "send_welcome_email",
      input: { userId: user.id, email: user.email, name: user.name },
    });
  }),
);

// 8. Wait for the job chain to complete
const result = await qrtClient.waitForJobChainCompletion(jobChain, { timeoutMs: 1000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);

// 9. Cleanup
await stopWorker();
await sql.end();
await pgContainer.stop();
