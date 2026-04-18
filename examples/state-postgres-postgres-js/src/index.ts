import { createPgStateAdapter } from "@queuert/postgres";
import { acquirePostgres } from "@queuert/testcontainers";
import postgres from "postgres";
import {
  createClient,
  createInProcessWorker,
  createJobTypeProcessorRegistry,
  defineJobTypeRegistry,
  withTransactionHooks,
  createInProcessNotifyAdapter,
} from "queuert";

import { createPostgresJsStateProvider } from "./provider.js";

// 1. Start PostgreSQL using testcontainers
await using pg = await acquirePostgres("postgres:18", import.meta.url);

// 2. Create database connection and schema
const sql = postgres(pg.connectionString, { max: 10 });

await sql`
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL
  )
`;

// 3. Define job types
const jobTypeRegistry = defineJobTypeRegistry<{
  send_welcome_email: {
    entry: true;
    input: { userId: number; email: string; name: string };
    output: { sentAt: string };
  };
}>();

// 4. Create providers and adapters
const stateProvider = createPostgresJsStateProvider({ sql });
const stateAdapter = await createPgStateAdapter({ stateProvider });
await stateAdapter.migrateToLatest();

const notifyAdapter = createInProcessNotifyAdapter();

const qrtClient = await createClient({
  stateAdapter,
  notifyAdapter,
  jobTypeRegistry,
});

const qrtWorker = await createInProcessWorker({
  client: qrtClient,
  jobTypeProcessorRegistry: createJobTypeProcessorRegistry({
    client: qrtClient,
    jobTypeRegistry,
    processors: {
      send_welcome_email: {
        attemptHandler: async ({ job, complete }) => {
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

// 5. Register a new user and queue welcome email atomically
const jobChain = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (txSql) => {
    const [user] = (await txSql.unsafe(
      "INSERT INTO users (name, email) VALUES ($1, $2) RETURNING *",
      ["Alice", "alice@example.com"],
    )) as { id: number; name: string; email: string }[];

    return qrtClient.startJobChain({
      sql: txSql,
      transactionHooks,
      typeName: "send_welcome_email",
      input: { userId: user.id, email: user.email, name: user.name },
    });
  }),
);

// 6. Wait for the job chain to complete
const result = await qrtClient.awaitJobChain(jobChain, { timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);

// 7. Cleanup
await stopWorker();
await sql.end();
