import { createPgStateAdapter } from "@queuert/postgres";
import { acquirePostgres } from "@queuert/testcontainers";
import { CompiledQuery, type Generated, Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import {
  createClient,
  createInProcessWorker,
  createJobTypeProcessorRegistry,
  defineJobTypeRegistry,
  withTransactionHooks,
  createInProcessNotifyAdapter,
} from "queuert";

import { createKyselyPgStateProvider } from "./provider.js";

// 1. Start PostgreSQL using testcontainers
await using pg = await acquirePostgres("postgres:18", import.meta.url);

// 2. Define Kysely database schema
type Database = {
  users: { id: Generated<number>; name: string; email: string };
};

// 3. Create database connection and schema
const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({
      connectionString: pg.connectionString,
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
const jobTypeRegistry = defineJobTypeRegistry<{
  send_welcome_email: {
    entry: true;
    input: { userId: number; email: string; name: string };
    output: { sentAt: string };
  };
}>();

// 5. Create state provider for Kysely
const stateProvider = createKyselyPgStateProvider({ db });

// 6. Create adapters and queuert client/worker
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

// 7. Create qrtWorker with job type processors
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

// 8. Register a new user and queue welcome email atomically
const jobChain = await withTransactionHooks(async (transactionHooks) =>
  db.transaction().execute(async (db) => {
    const user = await db
      .insertInto("users")
      .values({ name: "Alice", email: "alice@example.com" })
      .returningAll()
      .executeTakeFirstOrThrow();

    // Queue welcome email - if user creation fails, no email job is created
    return qrtClient.startJobChain({
      db,
      transactionHooks,
      typeName: "send_welcome_email",
      input: { userId: user.id, email: user.email, name: user.name },
    });
  }),
);

// 9. Wait for the job chain to complete
const result = await qrtClient.awaitJobChain(jobChain, { timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);

// 10. Cleanup
await stopWorker();
await db.destroy();
