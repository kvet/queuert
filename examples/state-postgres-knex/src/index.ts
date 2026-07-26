import { createPgStateAdapter } from "@queuert/postgres";
import { acquirePostgres } from "@queuert/testcontainers";
import knexFactory from "knex";
import {
  createClient,
  createInProcessNotifyAdapter,
  createInProcessWorker,
  createProcessors,
  defineJobTypes,
  withTransactionHooks,
} from "queuert";

import { createKnexPgStateProvider } from "./provider.js";

// 1. Start PostgreSQL using testcontainers
await using pg = await acquirePostgres("postgres:18", import.meta.url);

// 2. Create database connection
const knex = knexFactory({
  client: "pg",
  connection: pg.connectionString,
  pool: { min: 0, max: 10 },
});

// 3. Create application schema
await knex.raw(`
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL
  );
`);

// 4. Define job types
const jobTypes = defineJobTypes<{
  send_welcome_email: {
    entry: true;
    input: { userId: number };
    output: { sentAt: string };
  };
}>();

// 5. Create state provider for Knex
const stateProvider = createKnexPgStateProvider({ knex });

// 6. Create adapters and queuert client/worker
const stateAdapter = await createPgStateAdapter({
  stateProvider,
});
await stateAdapter.migrateToLatest();

const notifyAdapter = await createInProcessNotifyAdapter();

const client = await createClient({
  stateAdapter,
  notifyAdapter,
  jobTypes,
});

// 7. Create worker with job type processors
const worker = await createInProcessWorker({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      send_welcome_email: {
        attemptHandler: async ({ job, prepare, complete }) => {
          // Load the user with Knex inside the job transaction
          const user = await prepare({ mode: "staged" }, async ({ trx }) =>
            trx<{ id: number; name: string; email: string }>("users")
              .where({ id: job.input.userId })
              .first(),
          );
          if (!user) throw new Error(`User ${job.input.userId} not found`);

          // Simulate sending email (in real app, call email service here)
          console.log(`Sending welcome email to ${user.email} for ${user.name}`);

          return complete(async () => ({
            sentAt: new Date().toISOString(),
          }));
        },
      },
    },
  }),
});

const stopWorker = await worker.start();

// 8. Register a new user and queue welcome email atomically
const chain = await withTransactionHooks(async (transactionHooks) =>
  knex.transaction(async (trx) => {
    const [user] = await trx<{ id: number; name: string; email: string }>("users")
      .insert({ name: "Alice", email: "alice@example.com" })
      .returning(["id"]);

    // Queue welcome email - if user creation fails, no email job is created
    return client.startChain({
      trx,
      transactionHooks,
      typeName: "send_welcome_email",
      input: { userId: user.id },
    });
  }),
);

// 9. Wait for the chain to complete
const result = await client.awaitChain(chain, { timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);

// 10. Cleanup
await stopWorker();
await notifyAdapter.close();
await stateAdapter.close();
await knex.destroy();
