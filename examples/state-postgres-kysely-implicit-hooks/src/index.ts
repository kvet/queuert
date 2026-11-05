import assert from "node:assert/strict";

import { createPgStateAdapter } from "@queuert/postgres";
import { acquirePostgres } from "@queuert/testcontainers";
import { CompiledQuery, type Generated, Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import {
  createClient,
  createInProcessNotifyAdapter,
  createInProcessWorker,
  createProcessors,
  defineJobTypes,
} from "queuert";

import { createKyselyPgStateProvider } from "./provider.js";
import { createKyselyTransactions } from "./transaction.js";

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
const jobTypes = defineJobTypes<{
  send_welcome_email: {
    entry: true;
    input: { userId: number };
    output: { sentAt: string };
  };
}>();

// 5. Create the app's transaction helper and an implicit state provider built on it
const transactions = createKyselyTransactions({ db });
const { transaction, savepoint } = transactions;
const stateProvider = createKyselyPgStateProvider({ db, transactions });

// 6. Create adapters and queuert client/worker
const stateAdapter = await createPgStateAdapter({ stateProvider });
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
        attemptHandler: async ({ job, complete }) => {
          const user = await db
            .selectFrom("users")
            .selectAll()
            .where("id", "=", job.input.userId)
            .executeTakeFirstOrThrow();

          console.log(`Sending welcome email to ${user.email} for ${user.name}`);

          return transaction(async ({ db }) =>
            complete({ db, output: { sentAt: new Date().toISOString() } }),
          );
        },
      },
    },
  }),
});

const stopWorker = await worker.start();

// 8. Register a new user and queue welcome email atomically
const chain = await transaction(async ({ db }) => {
  const user = await db
    .insertInto("users")
    .values({ name: "Alice", email: "alice@example.com" })
    .returning("id")
    .executeTakeFirstOrThrow();

  return client.createChain({
    db,
    typeName: "send_welcome_email",
    input: { userId: user.id },
  });
});

// 9. Wait for the chain to complete
const result = await client.awaitChain(chain, { timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);

// 10. A savepoint that rolls back drops its user, its chain and the chain's notification,
//     while the rest of the transaction commits
const discardedChainId = crypto.randomUUID();
const keptUser = await transaction(async (txCtx) => {
  await savepoint(txCtx, async ({ db }) => {
    const user = await db
      .insertInto("users")
      .values({ name: "Bob", email: "bob@example.com" })
      .returning("id")
      .executeTakeFirstOrThrow();
    await client.createChain({
      db,
      id: discardedChainId,
      typeName: "send_welcome_email",
      input: { userId: user.id },
    });
    throw new Error("Bob's signup was cancelled");
  }).catch((error: unknown) => {
    console.log(`Savepoint rolled back: ${(error as Error).message}`);
  });

  return txCtx.db
    .insertInto("users")
    .values({ name: "Carol", email: "carol@example.com" })
    .returning("name")
    .executeTakeFirstOrThrow();
});

assert.equal(await client.getChain({ id: discardedChainId }), undefined);
console.log(`Committed ${keptUser.name}; the cancelled signup left no chain behind`);

// 11. Cleanup
await stopWorker();
await notifyAdapter.close();
await stateAdapter.close();
await db.destroy();
