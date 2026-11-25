import { createPgMigrator, createPgStateAdapter } from "@queuert/postgres";
import { acquirePostgres } from "@queuert/testcontainers";
import { SQL } from "bun";
import {
  createClient,
  createWorkerRunner,
  createProcessors,
  defineJobTypes,
  withTxHooks,
} from "queuert";

import { createMigrations } from "./migrations.ts";
import { createBunSqlStateProvider } from "./provider.ts";

await using pg = await acquirePostgres("postgres:18", import.meta.url);

await using sql = new SQL(pg.connectionString, { max: 10 });

await sql`
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL
  )
`;

const jobTypes = defineJobTypes<{
  "send-welcome-email": {
    entry: true;
    input: { userId: number };
    output: { sentAt: string };
  };
}>();

// #region adapter
const stateProvider = createBunSqlStateProvider({ sql });
await using stateAdapter = createPgStateAdapter({ stateProvider });
await stateAdapter.migrateToLatest();
// #endregion

const { applied } = await createPgMigrator({
  stateProvider,
  migrations: createMigrations({ sql }),
}).migrateToLatest();
console.log(`Applied app migrations: ${applied.join(", ")}`);
const invoices = await sql`SELECT number, customer, status FROM invoices ORDER BY id`;
console.log("Invoices:", invoices);

const client = createClient({ stateAdapter, jobTypes });

await using workerRunner = createWorkerRunner({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      "send-welcome-email": {
        attemptHandler: async ({ job, applyJobOutcome }) => {
          const [user]: { id: number; name: string; email: string }[] = await sql`
            SELECT id, name, email FROM users WHERE id = ${job.input.userId}
          `;
          if (!user) throw new Error(`User ${job.input.userId} not found`);

          console.log(`Sending welcome email to ${user.email} for ${user.name}`);

          await withTxHooks(async (txHooks) =>
            sql.begin(async (txSql) =>
              applyJobOutcome({ txSql, txHooks, output: { sentAt: new Date().toISOString() } }),
            ),
          );
        },
      },
    },
  }),
});

await workerRunner.start();

const chain = await withTxHooks(async (txHooks) =>
  sql.begin(async (txSql) => {
    const [user]: { id: number }[] = await txSql`
      INSERT INTO users (name, email) VALUES (${"Alice"}, ${"alice@example.com"}) RETURNING id
    `;

    return client.createChain({
      txSql,
      txHooks,
      typeName: "send-welcome-email",
      input: { userId: user.id },
    });
  }),
);

const result = await client.awaitChain({ chain, timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);
