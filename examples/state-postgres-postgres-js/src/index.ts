import { createPgStateAdapter } from "@queuert/postgres";
import { acquirePostgres } from "@queuert/testcontainers";
import postgres from "postgres";
import {
  createClient,
  createInProcessWorker,
  createProcessors,
  defineJobTypes,
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
const jobTypes = defineJobTypes<{
  send_welcome_email: {
    entry: true;
    input: { userId: number };
    output: { sentAt: string };
  };
}>();

// 4. Create providers and adapters
const stateProvider = createPostgresJsStateProvider({ sql });
const stateAdapter = await createPgStateAdapter({ stateProvider });
await stateAdapter.migrateToLatest();

const notifyAdapter = await createInProcessNotifyAdapter();

const client = await createClient({
  stateAdapter,
  notifyAdapter,
  jobTypes,
});

const worker = await createInProcessWorker({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      send_welcome_email: {
        attemptHandler: async ({ job, prepare, complete }) => {
          // Load the user with postgres.js inside the job transaction
          const user = await prepare({ mode: "staged" }, async ({ sql: txSql }) => {
            const [row] = await txSql<{ id: number; name: string; email: string }[]>`
              SELECT id, name, email FROM users WHERE id = ${job.input.userId}
            `;
            if (!row) throw new Error(`User ${job.input.userId} not found`);
            return row;
          });

          console.log(`Sending welcome email to ${user.email} for ${user.name}`);

          return complete(async ({ finish }) =>
            finish({ output: { sentAt: new Date().toISOString() } }),
          );
        },
      },
    },
  }),
});

const stopWorker = await worker.start();

// 5. Register a new user and queue welcome email atomically
const chain = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (txSql) => {
    const [user] = (await txSql.unsafe(
      "INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id",
      ["Alice", "alice@example.com"],
    )) as { id: number }[];

    return client.createChain({
      sql: txSql,
      transactionHooks,
      typeName: "send_welcome_email",
      input: { userId: user.id },
    });
  }),
);

// 6. Wait for the chain to complete
const result = await client.awaitChain(chain, { timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);

// 7. Cleanup
await stopWorker();
await notifyAdapter.close();
await stateAdapter.close();
await sql.end();
