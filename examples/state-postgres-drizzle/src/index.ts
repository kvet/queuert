import { createPgStateAdapter } from "@queuert/postgres";
import { acquirePostgres } from "@queuert/testcontainers";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, serial, text } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import {
  createClient,
  createWorkerRunner,
  createProcessors,
  defineJobTypes,
  withTxHooks,
  createInProcessNotifyAdapter,
} from "queuert";

import { createDrizzlePgStateProvider } from "./provider.ts";

// Start PostgreSQL using testcontainers
await using pg = await acquirePostgres("postgres:18", import.meta.url);

// Define Drizzle schema
const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
});

const schema = { users };

// Create database connection and schema
const pool = new Pool({
  connectionString: pg.connectionString,
  max: 10,
});

const db = drizzle(pool, { schema });

await db.execute(sql`
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL
  )
`);

// Define job types
const jobTypes = defineJobTypes<{
  send_welcome_email: {
    entry: true;
    input: { userId: number };
    output: { sentAt: string };
  };
}>();

// Create state provider for Drizzle
// #region adapter
const stateProvider = createDrizzlePgStateProvider({ db });
const stateAdapter = createPgStateAdapter({
  stateProvider,
});
await stateAdapter.migrateToLatest();
// #endregion

const notifyAdapter = createInProcessNotifyAdapter();

const client = createClient({
  stateAdapter,
  notifyAdapter,
  jobTypes,
});
const workerRunner = createWorkerRunner({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      send_welcome_email: {
        attemptHandler: async ({ job, complete }) => {
          const [user] = await db.select().from(users).where(eq(users.id, job.input.userId));
          if (!user) throw new Error(`User ${job.input.userId} not found`);

          // Simulate sending email (in real app, call email service here)
          console.log(`Sending welcome email to ${user.email} for ${user.name}`);

          return withTxHooks(async (txHooks) =>
            db.transaction(async (tx) =>
              complete({ tx, txHooks, output: { sentAt: new Date().toISOString() } }),
            ),
          );
        },
      },
    },
  }),
});

// Start worker runner
const stopWorkerRunner = await workerRunner.start();

// Register a new user and queue welcome email atomically
const chain = await withTxHooks(async (txHooks) =>
  db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ name: "Alice", email: "alice@example.com" })
      .returning({ id: users.id });

    // Queue welcome email - if user creation fails, no email job is created
    return client.createChain({
      tx,
      txHooks,
      typeName: "send_welcome_email",
      input: { userId: user.id },
    });
  }),
);

// Wait for the chain to complete
const result = await client.awaitChain(chain, { timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);

// Cleanup
await stopWorkerRunner();
await notifyAdapter.close();
await stateAdapter.close();
await db.$client.end();
