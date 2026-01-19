import { createPgStateAdapter, PgStateProvider } from "@queuert/postgres";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { ExtractTablesWithRelations, sql } from "drizzle-orm";
import { drizzle, NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import { integer, pgTable, PgTransaction, serial, text } from "drizzle-orm/pg-core";
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
});

const pet = pgTable("pet", {
  id: serial("id").primaryKey(),
  ownerId: integer("owner_id")
    .references(() => users.id)
    .notNull(),
  name: text("name").notNull(),
});

const schema = { users, pet };

// 3. Create database connection and schema
const pool = new Pool({
  connectionString: pgContainer.getConnectionUri(),
  max: 10,
});

const db = drizzle(pool, { schema });

await db.execute(sql`
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL
  )
`);
await db.execute(sql`
  CREATE TABLE IF NOT EXISTS pet (
    id SERIAL PRIMARY KEY,
    owner_id INTEGER REFERENCES users(id),
    name TEXT NOT NULL
  )
`);

// 4. Define job types
const jobTypeRegistry = defineJobTypes<{
  add_pet_to_user: {
    entry: true;
    input: { userId: number; petName: string };
    output: { petId: number };
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
    add_pet_to_user: {
      process: async ({ job, complete }) => {
        return complete(async ({ tx }) => {
          const [result] = await tx
            .insert(pet)
            .values({
              ownerId: job.input.userId,
              name: job.input.petName,
            })
            .returning();

          return { petId: result.id };
        });
      },
    },
  },
});

// 7. Start qrtWorker
const stopWorker = await qrtWorker.start();

// 8. Create a user and queue a job atomically in the same transaction
const jobChain = await qrtClient.withNotify(async () =>
  db.transaction(async (tx) => {
    const [user] = await tx.insert(users).values({ name: "Alice" }).returning();

    return qrtClient.startJobChain({
      tx,
      typeName: "add_pet_to_user",
      input: { userId: user.id, petName: "Fluffy" },
    });
  }),
);

// 9. Wait for the job chain to complete
await qrtClient.waitForJobChainCompletion(jobChain, { timeoutMs: 1000 });

// 10. Cleanup
await stopWorker();
await db.$client.end();
await pgContainer.stop();
