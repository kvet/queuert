import { createAsyncRwLock, createAsyncSqliteStateAdapter } from "@queuert/sqlite";
import { SQL } from "bun";
import {
  createClient,
  createInProcessNotifyAdapter,
  createInProcessWorker,
  createProcessors,
  defineJobTypes,
  withTransactionHooks,
} from "queuert";

import { createBunSqlSqliteStateProvider } from "./provider.js";

// 1. Create in-memory SQLite database
const sql = new SQL("sqlite://:memory:");

// 2. Create application schema
await sql`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
const lock = createAsyncRwLock();
const stateProvider = createBunSqlSqliteStateProvider({ sql, lock });
const stateAdapter = createAsyncSqliteStateAdapter({ stateProvider });
await stateAdapter.migrateToLatest();

const notifyAdapter = createInProcessNotifyAdapter();

const client = createClient({
  stateAdapter,
  notifyAdapter,
  jobTypes,
});

const worker = createInProcessWorker({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      send_welcome_email: {
        attemptHandler: async ({ job, complete }) => {
          let user: { id: number; name: string; email: string } | undefined;
          {
            using _h = await lock.acquireRead();
            [user] = await sql`SELECT id, name, email FROM users WHERE id = ${job.input.userId}`;
          }
          if (!user) throw new Error(`User ${job.input.userId} not found`);

          // Simulate sending email (in real app, call email service here)
          console.log(`Sending welcome email to ${user.email} for ${user.name}`);

          return withTransactionHooks(async (transactionHooks) => {
            // The handler's transaction holds the provider's write lock, so the worker's
            // autocommit statements on this connection cannot run inside it.
            using _h = await lock.acquireWrite();
            return await sql.begin(async (txSql) =>
              complete({ txSql, transactionHooks, output: { sentAt: new Date().toISOString() } }),
            );
          });
        },
      },
    },
  }),
});

const stopWorker = await worker.start();

// 5. Register a new user and queue welcome email atomically
//    Bun.SQL does not queue SQLite transactions on its single connection, so take the same lock
const chain = await withTransactionHooks(async (transactionHooks) => {
  using _h = await lock.acquireWrite();
  return await sql.begin(async (txSql) => {
    const [user]: { id: number }[] = await txSql`
      INSERT INTO users (name, email) VALUES (${"Alice"}, ${"alice@example.com"}) RETURNING id
    `;

    return client.createChain({
      txSql,
      transactionHooks,
      typeName: "send_welcome_email",
      input: { userId: user.id },
    });
  });
});

// 6. Wait for the chain to complete
const result = await client.awaitChain(chain, { timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);

// 7. Cleanup
await stopWorker();
await notifyAdapter.close();
await stateAdapter.close();
await sql.close();
