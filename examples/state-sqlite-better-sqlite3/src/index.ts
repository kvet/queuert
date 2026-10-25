import { createSyncSqliteStateAdapter } from "@queuert/sqlite";
import Database from "better-sqlite3";
import {
  createClient,
  createInProcessNotifyAdapter,
  createInProcessWorker,
  createProcessors,
  defineJobTypes,
  withTransactionHooks,
} from "queuert";

import { createBetterSqlite3StateProvider } from "./provider.js";

// 1. Create in-memory SQLite database
const db = new Database(":memory:");

// 2. Create application schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL
  );
`);

// 3. Define job types
const jobTypes = defineJobTypes<{
  send_welcome_email: {
    entry: true;
    input: { userId: number };
    output: { sentAt: string };
  };
}>();

// 4. Create providers and adapters
const stateProvider = createBetterSqlite3StateProvider({ db });
const stateAdapter = createSyncSqliteStateAdapter({ stateProvider });
stateAdapter.migrateToLatest();

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
          const user = db
            .prepare("SELECT id, name, email FROM users WHERE id = ?")
            .get(job.input.userId) as { id: number; name: string; email: string } | undefined;
          if (!user) throw new Error(`User ${job.input.userId} not found`);

          // Simulate sending email (in real app, call email service here)
          console.log(`Sending welcome email to ${user.email} for ${user.name}`);

          // The state adapter is in sync mode, so `complete` runs inside better-sqlite3's
          // native synchronous transaction.
          return withTransactionHooks((transactionHooks) =>
            db.transaction(() =>
              complete({ db, transactionHooks, output: { sentAt: new Date().toISOString() } }),
            )(),
          );
        },
      },
    },
  }),
});

const stopWorker = await worker.start();

// 5. Register a new user and queue welcome email atomically
const chain = withTransactionHooks((transactionHooks) =>
  db.transaction(() => {
    const user = db
      .prepare("INSERT INTO users (name, email) VALUES (?, ?) RETURNING id")
      .get("Alice", "alice@example.com") as { id: number };

    return client.createChain({
      db,
      transactionHooks,
      typeName: "send_welcome_email",
      input: { userId: user.id },
    });
  })(),
);

// 6. Wait for the chain to complete
const result = await client.awaitChain(chain, { timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);

// 7. Cleanup
await stopWorker();
await notifyAdapter.close();
stateAdapter.close();
db.close();
