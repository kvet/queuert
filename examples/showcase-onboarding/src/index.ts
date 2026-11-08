import { randomUUID } from "node:crypto";

import { createPgStateAdapter } from "@queuert/postgres";
import { acquirePostgres } from "@queuert/testcontainers";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createDrizzlePgStateProvider } from "example-state-postgres-drizzle/provider";
import { Pool } from "pg";
import {
  createClient,
  createWorkerRunner,
  createProcessors,
  defineJobTypes,
  withTxHooks,
} from "queuert";

await using pg = await acquirePostgres("postgres:18", import.meta.url);

const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull(),
});

const pool = new Pool({ connectionString: pg.connectionString });
const db = drizzle(pool, { schema: { users } });
await db.execute(sql`
  CREATE TABLE users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, email TEXT NOT NULL);
`);

const stateAdapter = createPgStateAdapter({
  stateProvider: createDrizzlePgStateProvider({ db }),
});
await stateAdapter.migrateToLatest();

const provisionAccount = async (userId: string): Promise<string> => {
  console.log(`Provisioning an account for user ${userId}`);
  return randomUUID();
};
const sendWelcomeEmail = async (userId: string): Promise<void> => {
  console.log(`Sending welcome email to user ${userId}`);
};
const syncToCrm = async (userId: string, accountId: string): Promise<string> => {
  console.log(`Syncing user ${userId} with account ${accountId} to the CRM`);
  return new Date().toISOString();
};

// #region define
const jobTypes = defineJobTypes<{
  "provision-account": {
    entry: true;
    input: { userId: string };
    continueWith: { typeName: "send-welcome-email" };
  };
  "send-welcome-email": {
    input: { userId: string; accountId: string };
    continueWith: { typeName: "sync-to-crm" };
  };
  "sync-to-crm": {
    input: { userId: string; accountId: string };
    output: { syncedAt: string };
  };
}>();
const client = createClient({ stateAdapter, jobTypes });
// #endregion

// #region process
const workerRunner = createWorkerRunner({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      "provision-account": {
        attemptHandler: async ({ job, complete }) => {
          const accountId = await provisionAccount(job.input.userId);

          return withTxHooks(async (txHooks) =>
            db.transaction(async (tx) =>
              complete({
                tx,
                txHooks,
                continueWith: {
                  typeName: "send-welcome-email",
                  input: { userId: job.input.userId, accountId },
                  //      ↑ missing accountId would be a compile error
                },
              }),
            ),
          );
        },
      },
      // ...handlers for "send-welcome-email" and "sync-to-crm"
      // #hide
      "send-welcome-email": {
        attemptHandler: async ({ job, complete }) => {
          await sendWelcomeEmail(job.input.userId);

          return withTxHooks(async (txHooks) =>
            db.transaction(async (tx) =>
              complete({
                tx,
                txHooks,
                continueWith: { typeName: "sync-to-crm", input: job.input },
              }),
            ),
          );
        },
      },
      "sync-to-crm": {
        attemptHandler: async ({ job, complete }) => {
          const syncedAt = await syncToCrm(job.input.userId, job.input.accountId);

          return withTxHooks(async (txHooks) =>
            db.transaction(async (tx) => complete({ tx, txHooks, output: { syncedAt } })),
          );
        },
      },
      // #endhide
    },
  }),
});

const stop = await workerRunner.start();
// #endregion

// #region create-chain
const chain = await withTxHooks(async (txHooks) =>
  db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ name: "Alice", email: "alice@example.com" })
      .returning({ id: users.id });

    return client.createChain({
      tx,
      txHooks,
      typeName: "provision-account",
      input: { userId: user.id },
      //         ↑ wrong shape here is a compile error
    });
  }),
);
// #endregion

const result = await client.awaitChain(chain, { timeoutMs: 10_000 });
console.log(`Onboarding finished, synced to the CRM at ${result.output.syncedAt}`);

await stop();
await stateAdapter.close();
await pool.end();
