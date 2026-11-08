import { createAsyncRwLock, createSqliteStateAdapter } from "@queuert/sqlite";
import Database from "better-sqlite3";
import {
  createClient,
  createInProcessNotifyAdapter,
  createInProcessWorker,
  createProcessors,
  defineJobTypes,
  withTransactionHooks,
} from "queuert";

import { createBetterSqlite3StateProvider } from "./provider.ts";

// Create in-memory SQLite database
const db = new Database(":memory:");

// Create application schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL
  );
`);

// Define job types
const jobTypes = defineJobTypes<{
  send_welcome_email: {
    entry: true;
    input: { userId: number };
    output: { sentAt: string };
  };
}>();

// Create providers and adapters
// #region adapter
const lock = createAsyncRwLock();
const stateProvider = createBetterSqlite3StateProvider({ db, lock });
const stateAdapter = await createSqliteStateAdapter({ stateProvider });
await stateAdapter.migrateToLatest();
// #endregion

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
          let user: { id: number; name: string; email: string } | undefined;
          {
            using _h = await lock.acquireRead();
            user = db
              .prepare("SELECT id, name, email FROM users WHERE id = ?")
              .get(job.input.userId) as { id: number; name: string; email: string } | undefined;
          }
          if (!user) throw new Error(`User ${job.input.userId} not found`);

          // Simulate sending email (in real app, call email service here)
          console.log(`Sending welcome email to ${user.email} for ${user.name}`);

          return withTransactionHooks(async (transactionHooks) => {
            // The handler's transaction holds the provider's write lock, so the worker's
            // autocommit statements on this connection cannot run inside it.
            using _h = await lock.acquireWrite();
            db.exec("BEGIN");
            try {
              const result = await complete({
                db,
                transactionHooks,
                output: { sentAt: new Date().toISOString() },
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
        },
      },
    },
  }),
});

const stopWorker = await worker.start();

// Register a new user and queue welcome email atomically
// #region create-chain
const chain = await withTransactionHooks(async (transactionHooks) => {
  using _h = await lock.acquireWrite();
  db.exec("BEGIN");
  try {
    const insertStmt = db.prepare("INSERT INTO users (name, email) VALUES (?, ?) RETURNING id");
    const user = insertStmt.get("Alice", "alice@example.com") as { id: number };

    const result = await client.createChain({
      db,
      transactionHooks,
      typeName: "send_welcome_email",
      input: { userId: user.id },
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
// #endregion

// Wait for the chain to complete
const result = await client.awaitChain(chain, { timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);

// Cleanup
await stopWorker();
await notifyAdapter.close();
await stateAdapter.close();
db.close();
