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
    input: { userId: number; email: string; name: string };
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
const chain = await withTransactionHooks(async (transactionHooks) => {
  using _h = await lock.acquireWrite();
  db.run("BEGIN");
  try {
    const user = db
      .query<{ id: number; name: string; email: string }, [string, string]>(
        "INSERT INTO users (name, email) VALUES (?, ?) RETURNING *",
      )
      .get("Alice", "alice@example.com");
    if (!user) throw new Error("Failed to insert user");

    const result = await client.startChain({
      db,
      transactionHooks,
      typeName: "send_welcome_email",
      input: { userId: user.id, email: user.email, name: user.name },
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
