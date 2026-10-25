import { DatabaseSync } from "node:sqlite";

import { createSyncSqliteStateAdapter } from "@queuert/sqlite";
import {
  createClient,
  createInProcessNotifyAdapter,
  createInProcessWorker,
  createProcessors,
  defineJobTypes,
  withTransactionHooks,
} from "queuert";

import { createNodeSqliteStateProvider } from "./provider.js";

// 1. Create in-memory SQLite database
const db = new DatabaseSync(":memory:");

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

// 4. Create state provider for node:sqlite
const stateProvider = createNodeSqliteStateProvider({ db });

// 5. Create adapters and queuert client/worker
const stateAdapter = createSyncSqliteStateAdapter({ stateProvider });
stateAdapter.migrateToLatest();

const notifyAdapter = createInProcessNotifyAdapter();

const client = createClient({
  stateAdapter,
  notifyAdapter,
  jobTypes,
});

// 6. Create and start worker
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

          // The state adapter is in sync mode, so `complete` runs inside a synchronous transaction.
          return withTransactionHooks((transactionHooks) =>
            stateProvider.withTransaction(() =>
              complete({ db, transactionHooks, output: { sentAt: new Date().toISOString() } }),
            ),
          );
        },
      },
    },
  }),
});

const stopWorker = await worker.start();

// 7. Register a new user and queue welcome email atomically
const chain = withTransactionHooks((transactionHooks) =>
  stateProvider.withTransaction(() => {
    const user = db
      .prepare("INSERT INTO users (name, email) VALUES (?, ?) RETURNING id")
      .get("Alice", "alice@example.com") as { id: number };

    // Queue welcome email - if user creation fails, no email job is created
    return client.createChain({
      db,
      transactionHooks,
      typeName: "send_welcome_email",
      input: { userId: user.id },
    });
  }),
);

// 8. Wait for the chain to complete
const result = await client.awaitChain(chain, { timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);

// 9. Cleanup
await stopWorker();
await notifyAdapter.close();
stateAdapter.close();
db.close();
