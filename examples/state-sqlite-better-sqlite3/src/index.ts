import { createAsyncRwLock, createSqliteStateAdapter } from "@queuert/sqlite";
import Database from "better-sqlite3";
import {
  createClient,
  createInProcessWorker,
  createProcessors,
  defineJobTypes,
  withTransactionHooks,
  createInProcessNotifyAdapter,
} from "queuert";

import { createBetterSqlite3StateProvider } from "./provider.js";

// 1. Create in-memory SQLite database
const db = new Database(":memory:");
db.pragma("auto_vacuum = INCREMENTAL");
db.pragma("foreign_keys = ON");

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
    input: { userId: number; email: string; name: string };
    output: { sentAt: string };
  };
}>();

// 4. Create providers and adapters
const lock = createAsyncRwLock();
const stateProvider = createBetterSqlite3StateProvider({ db, lock });
const stateAdapter = await createSqliteStateAdapter({ stateProvider });
await stateAdapter.migrateToLatest();

const notifyAdapter = await createInProcessNotifyAdapter();

const client = await createClient({
  stateAdapter,
  notifyAdapter,
  jobTypes,
});

const worker = await createInProcessWorker({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      send_welcome_email: {
        attemptHandler: async ({ job, complete }) => {
          console.log(`Sending welcome email to ${job.input.email} for ${job.input.name}`);

          return complete(async () => ({
            sentAt: new Date().toISOString(),
          }));
        },
      },
    },
  }),
});

const stopWorker = await worker.start();

// 5. Register a new user and queue welcome email atomically
const jobChain = await withTransactionHooks(async (transactionHooks) => {
  using _h = await lock.acquireWrite();
  db.exec("BEGIN IMMEDIATE");
  try {
    const insertStmt = db.prepare("INSERT INTO users (name, email) VALUES (?, ?) RETURNING *");
    const user = insertStmt.get("Alice", "alice@example.com") as {
      id: number;
      name: string;
      email: string;
    };

    const result = await client.startJobChain({
      db,
      transactionHooks,
      typeName: "send_welcome_email",
      input: { userId: user.id, email: user.email, name: user.name },
    });

    db.exec("COMMIT");
    return result;
  } catch (error) {
    if (db.inTransaction) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // ignore rollback errors
      }
    }
    throw error;
  }
});

// 6. Wait for the job chain to complete
const result = await client.awaitJobChain(jobChain, { timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);

// 7. Cleanup
await stopWorker();
await notifyAdapter.close();
await stateAdapter.close();
db.close();
