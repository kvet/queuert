import { DatabaseSync } from "node:sqlite";

import { createAsyncLock, createSqliteStateAdapter } from "@queuert/sqlite";
import {
  createClient,
  createInProcessWorker,
  createJobTypeProcessorRegistry,
  defineJobTypeRegistry,
  withTransactionHooks,
  createInProcessNotifyAdapter,
} from "queuert";

import { createNodeSqliteStateProvider } from "./provider.js";

// 1. Create in-memory SQLite database
const db = new DatabaseSync(":memory:");
db.exec("PRAGMA auto_vacuum = INCREMENTAL");
db.exec("PRAGMA foreign_keys = ON");

// 2. Create application schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL
  );
`);

// 3. Define job types
const jobTypeRegistry = defineJobTypeRegistry<{
  send_welcome_email: {
    entry: true;
    input: { userId: number; email: string; name: string };
    output: { sentAt: string };
  };
}>();

// 4. Create state provider for node:sqlite
const lock = createAsyncLock();
const stateProvider = createNodeSqliteStateProvider({ db, lock });

// 5. Create adapters and queuert client/worker
const stateAdapter = await createSqliteStateAdapter({ stateProvider });
await stateAdapter.migrateToLatest();

const notifyAdapter = createInProcessNotifyAdapter();

const qrtClient = await createClient({
  stateAdapter,
  notifyAdapter,
  jobTypeRegistry,
});

// 6. Create and start qrtWorker
const qrtWorker = await createInProcessWorker({
  client: qrtClient,
  jobTypeProcessorRegistry: createJobTypeProcessorRegistry({
    client: qrtClient,
    jobTypeRegistry,
    processors: {
      send_welcome_email: {
        attemptHandler: async ({ job, complete }) => {
          // Simulate sending email (in real app, call email service here)
          console.log(`Sending welcome email to ${job.input.email} for ${job.input.name}`);

          return complete(async () => ({
            sentAt: new Date().toISOString(),
          }));
        },
      },
    },
  }),
});

const stopWorker = await qrtWorker.start();

// 7. Register a new user and queue welcome email atomically
const jobChain = await withTransactionHooks(async (transactionHooks) => {
  await lock.acquire();
  try {
    db.exec("BEGIN IMMEDIATE");

    const insertStmt = db.prepare("INSERT INTO users (name, email) VALUES (?, ?) RETURNING *");
    const user = insertStmt.get("Alice", "alice@example.com") as {
      id: number;
      name: string;
      email: string;
    };

    // Queue welcome email - if user creation fails, no email job is created
    const result = await qrtClient.startJobChain({
      db,
      transactionHooks,
      typeName: "send_welcome_email",
      input: { userId: user.id, email: user.email, name: user.name },
    });

    db.exec("COMMIT");
    return result;
  } catch (error) {
    if (db.isTransaction) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // ignore rollback errors
      }
    }
    throw error;
  } finally {
    lock.release();
  }
});

// 8. Wait for the job chain to complete
const result = await qrtClient.awaitJobChain(jobChain, { timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);

// 9. Cleanup
await stopWorker();
db.close();
