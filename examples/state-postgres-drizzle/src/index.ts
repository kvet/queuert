import { createPgStateAdapter, PgStateProvider } from "@queuert/postgres";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { ExtractTablesWithRelations, sql } from "drizzle-orm";
import { drizzle, NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import { pgTable, PgTransaction, serial, text } from "drizzle-orm/pg-core";
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

// 2. Define Drizzle schema
const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
});

const schema = { users };

// 3. Create database connection and schema
const pool = new Pool({
  connectionString: pgContainer.getConnectionUri(),
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

// 4. Define job types
const jobTypeRegistry = defineJobTypes<{
  send_welcome_email: {
    entry: true;
    input: { userId: number; email: string; name: string };
    output: { sentAt: string };
  };
}>();

// 5. Create state provider for Drizzle
type DbTransaction = PgTransaction<
  NodePgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;
type DbContext = { tx: DbTransaction };

const stateProvider: PgStateProvider<DbContext> = {
  runInTransaction: async (cb) => {
    return db.transaction(async (tx) => cb({ tx }));
  },
  executeSql: async ({ txContext, sql, params }) => {
    // Inside transaction: access Drizzle's internal pg client
    // Outside transaction (migrations): use db.$client (the pool)
    const client = txContext ? (txContext.tx as any).session.client : (db as any).$client;
    const result = await client.query(sql, params);
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
const qrtWorker = await createQueuertInProcessWorker({
  stateAdapter,
  notifyAdapter,
  log,
  jobTypeRegistry,
  jobTypeProcessors: {
    send_welcome_email: {
      process: async ({ job, complete }) => {
        // Simulate sending email (in real app, call email service here)
        console.log(`Sending welcome email to ${job.input.email} for ${job.input.name}`);

        return complete(async () => ({
          sentAt: new Date().toISOString(),
        }));
      },
    },
  },
});

// 7. Start qrtWorker
const stopWorker = await qrtWorker.start();

// 8. Register a new user and queue welcome email atomically
const jobChain = await qrtClient.withNotify(async () =>
  db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ name: "Alice", email: "alice@example.com" })
      .returning();

    // Queue welcome email - if user creation fails, no email job is created
    return qrtClient.startJobChain({
      tx,
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
await db.$client.end();
await pgContainer.stop();
