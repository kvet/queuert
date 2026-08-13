import { Database } from "bun:sqlite";

import { createAsyncRwLock, createSqliteStateAdapter } from "@queuert/sqlite";
import {
  createClient,
  createInProcessWorker,
  createProcessors,
  defineJobTypes,
  withTransactionHooks,
  createInProcessNotifyAdapter,
} from "queuert";

import { createBunSqliteStateProvider } from "./provider.js";

// 1. Create in-memory SQLite database
const db = new Database(":memory:");
db.run("PRAGMA auto_vacuum = INCREMENTAL");
db.run("PRAGMA foreign_keys = ON");

// 2. Create application schema
db.run(`
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
const lock = createAsyncRwLock();
const stateProvider = createBunSqliteStateProvider({ db, lock });
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
        attemptHandler: async ({ job, prepare, complete }) => {
          // Load the user with bun:sqlite inside the job transaction
          const user = await prepare({ mode: "staged" }, ({ db }) => {
            const row = db
              .query<{ id: number; name: string; email: string }, [number]>(
                "SELECT id, name, email FROM users WHERE id = ?",
              )
              .get(job.input.userId);
            if (!row) throw new Error(`User ${job.input.userId} not found`);
            return row;
          });

          console.log(`Sending welcome email to ${user.email} for ${user.name}`);

          return complete(async ({ finish }) =>
            finish({ output: { sentAt: new Date().toISOString() } }),
          );
        },
      },
    },
  }),
});

const stopWorker = await worker.start();

// 5. Register a new user and queue welcome email atomically
const chain = await withTransactionHooks(async (transactionHooks) => {
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
      transactionHooks,
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

// 6. Wait for the chain to complete
const result = await client.awaitChain(chain, { timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);

// 7. Cleanup
await stopWorker();
await notifyAdapter.close();
await stateAdapter.close();
db.close();
