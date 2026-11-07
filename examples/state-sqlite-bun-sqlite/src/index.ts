import { Database } from "bun:sqlite";

import { createAsyncRwLock, createSqliteStateAdapter } from "@queuert/sqlite";
import {
  createClient,
  createInProcessNotifyAdapter,
  createWorkerRunner,
  createProcessors,
  defineJobTypes,
  withTxHooks,
} from "queuert";

import { createBunSqliteStateProvider } from "./provider.ts";

// Create in-memory SQLite database
const db = new Database(":memory:");

// Create application schema
db.run(`
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
const stateProvider = createBunSqliteStateProvider({ db, lock });
const stateAdapter = createSqliteStateAdapter({ stateProvider });
await stateAdapter.migrateToLatest();
// #endregion

const notifyAdapter = createInProcessNotifyAdapter();

const client = createClient({
  stateAdapter,
  notifyAdapter,
  jobTypes,
});

const workerRunner = createWorkerRunner({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      send_welcome_email: {
        attemptHandler: async ({ job, complete }) => {
          let user: { id: number; name: string; email: string } | null;
          {
            using _h = await lock.acquireRead();
            user = db
              .query<{ id: number; name: string; email: string }, [number]>(
                "SELECT id, name, email FROM users WHERE id = ?",
              )
              .get(job.input.userId);
          }
          if (!user) throw new Error(`User ${job.input.userId} not found`);

          // Simulate sending email (in real app, call email service here)
          console.log(`Sending welcome email to ${user.email} for ${user.name}`);

          return withTxHooks(async (txHooks) => {
            // The handler's transaction holds the provider's write lock, so the worker's
            // autocommit statements on this connection cannot run inside it.
            using _h = await lock.acquireWrite();
            db.run("BEGIN");
            try {
              const result = await complete({
                db,
                txHooks,
                output: { sentAt: new Date().toISOString() },
              });
              db.run("COMMIT");
              return result;
            } catch (error) {
              if (db.inTransaction) {
                try {
                  db.run("ROLLBACK");
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

const stopWorkerRunner = await workerRunner.start();

// Register a new user and queue welcome email atomically
// #region create-chain
const chain = await withTxHooks(async (txHooks) => {
  using _h = await lock.acquireWrite();
  db.run("BEGIN");
  try {
    const user = db
      .query<{ id: number }, [string, string]>(
        "INSERT INTO users (name, email) VALUES (?, ?) RETURNING id",
      )
      .get("Alice", "alice@example.com");
    if (!user) throw new Error("Failed to insert user");

    const result = await client.createChain({
      db,
      txHooks,
      typeName: "send_welcome_email",
      input: { userId: user.id },
    });

    db.run("COMMIT");
    return result;
  } catch (error) {
    if (db.inTransaction) {
      try {
        db.run("ROLLBACK");
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
await stopWorkerRunner();
await notifyAdapter.close();
await stateAdapter.close();
db.close();
