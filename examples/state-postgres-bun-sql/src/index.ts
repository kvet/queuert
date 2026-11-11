import { createPgStateAdapter } from "@queuert/postgres";
import { acquirePostgres } from "@queuert/testcontainers";
import { SQL } from "bun";
import {
  createClient,
  createWorkerRunner,
  createProcessors,
  defineJobTypes,
  withTxHooks,
} from "queuert";

import { createBunSqlStateProvider } from "./provider.ts";

// Start PostgreSQL using testcontainers
await using pg = await acquirePostgres("postgres:18", import.meta.url);

// Create database connection and schema
await using sql = new SQL(pg.connectionString, { max: 10 });

await sql`
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL
  )
`;

// Define job types
const jobTypes = defineJobTypes<{
  send_welcome_email: {
    entry: true;
    input: { userId: number };
    output: { sentAt: string };
  };
}>();

// Create providers and adapters
// #region adapter
const stateProvider = createBunSqlStateProvider({ sql });
await using stateAdapter = createPgStateAdapter({ stateProvider });
await stateAdapter.migrateToLatest();
// #endregion

const client = createClient({ stateAdapter, jobTypes });

await using workerRunner = createWorkerRunner({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      send_welcome_email: {
        attemptHandler: async ({ job, complete }) => {
          const [user]: { id: number; name: string; email: string }[] = await sql`
            SELECT id, name, email FROM users WHERE id = ${job.input.userId}
          `;
          if (!user) throw new Error(`User ${job.input.userId} not found`);

          // Simulate sending email (in real app, call email service here)
          console.log(`Sending welcome email to ${user.email} for ${user.name}`);

          return withTxHooks(async (txHooks) =>
            sql.begin(async (txSql) =>
              complete({ txSql, txHooks, output: { sentAt: new Date().toISOString() } }),
            ),
          );
        },
      },
    },
  }),
});

await workerRunner.start();

// Register a new user and queue welcome email atomically
const chain = await withTxHooks(async (txHooks) =>
  sql.begin(async (txSql) => {
    const [user]: { id: number }[] = await txSql`
      INSERT INTO users (name, email) VALUES (${"Alice"}, ${"alice@example.com"}) RETURNING id
    `;

    return client.createChain({
      txSql,
      txHooks,
      typeName: "send_welcome_email",
      input: { userId: user.id },
    });
  }),
);

// Wait for the chain to complete
const result = await client.awaitChain(chain, { timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);
