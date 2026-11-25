import assert from "node:assert/strict";

import { createPgMigrator, createPgStateAdapter } from "@queuert/postgres";
import { acquirePostgres } from "@queuert/testcontainers";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  createClient,
  createWorkerRunner,
  createProcessors,
  defineJobTypes,
  withTxHooks,
} from "queuert";

import { createMigrations } from "./migrations.ts";
import { createDrizzlePgStateProvider } from "./provider.ts";
import * as schema from "./schema.ts";
import { invoices, users } from "./schema.ts";

await using pg = await acquirePostgres("postgres:18", import.meta.url);

await using drivers = new AsyncDisposableStack();
const pool = drivers.adopt(
  new Pool({ connectionString: pg.connectionString, max: 10 }),
  async (pool) => pool.end(),
);

const db = drizzle(pool, { schema });

await db.execute(sql`
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL
  )
`);

const jobTypes = defineJobTypes<{
  "send-welcome-email": {
    entry: true;
    input: { userId: number };
    output: { sentAt: string };
  };
}>();

// #region adapter
const stateProvider = createDrizzlePgStateProvider({ db });
await using stateAdapter = createPgStateAdapter({
  stateProvider,
});
await stateAdapter.migrateToLatest();
// #endregion

const migrator = createPgMigrator({ stateProvider, migrations: createMigrations({ db }) });
const { applied } = await migrator.migrateToLatest();
console.log(`Applied application migrations: ${applied.join(", ")}`);

const openInvoices = await db
  .select()
  .from(invoices)
  .where(eq(invoices.status, "open"))
  .orderBy(invoices.id);
assert.deepEqual(
  openInvoices.map((invoice) => invoice.customer),
  ["ACME", "GLOBEX", "INITECH"],
);

const client = createClient({ stateAdapter, jobTypes });
await using workerRunner = createWorkerRunner({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      "send-welcome-email": {
        attemptHandler: async ({ job, applyJobOutcome }) => {
          const [user] = await db.select().from(users).where(eq(users.id, job.input.userId));
          if (!user) throw new Error(`User ${job.input.userId} not found`);

          console.log(`Sending welcome email to ${user.email} for ${user.name}`);

          await withTxHooks(async (txHooks) =>
            db.transaction(async (tx) =>
              applyJobOutcome({ tx, txHooks, output: { sentAt: new Date().toISOString() } }),
            ),
          );
        },
      },
    },
  }),
});

await workerRunner.start();

const chain = await withTxHooks(async (txHooks) =>
  db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ name: "Alice", email: "alice@example.com" })
      .returning({ id: users.id });

    return client.createChain({
      tx,
      txHooks,
      typeName: "send-welcome-email",
      input: { userId: user.id },
    });
  }),
);

const result = await client.awaitChain({ chain, timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);
