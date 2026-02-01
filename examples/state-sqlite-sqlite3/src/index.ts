import {
  type SqliteStateProvider,
  createAsyncLock,
  createSqliteStateAdapter,
} from "@queuert/sqlite";
import { createQueuertClient, createQueuertInProcessWorker, defineJobTypes } from "queuert";
import { createInProcessNotifyAdapter } from "queuert/internal";
import sqlite3 from "sqlite3";

// Promisify sqlite3 callback-based methods
const promisify = {
  run: async (db: sqlite3.Database, sql: string, params?: unknown[]): Promise<sqlite3.RunResult> =>
    new Promise((resolve, reject) => {
      db.run(sql, params ?? [], function (err) {
        if (err) reject(err);
        else resolve(this);
      });
    }),
  all: async <T>(db: sqlite3.Database, sql: string, params?: unknown[]): Promise<T[]> =>
    new Promise((resolve, reject) => {
      db.all(sql, params ?? [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows as T[]);
      });
    }),
  exec: async (db: sqlite3.Database, sql: string): Promise<void> =>
    new Promise((resolve, reject) => {
      db.exec(sql, (err) => {
        if (err) reject(err);
        else resolve();
      });
    }),
};

// 1. Create in-memory SQLite database
const db = new sqlite3.Database(":memory:");

// Configure foreign keys
await promisify.exec(db, "PRAGMA foreign_keys = ON");

// 2. Create users table
await promisify.exec(
  db,
  `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL
  );
`,
);

// 3. Define job types
const registry = defineJobTypes<{
  send_welcome_email: {
    entry: true;
    input: { userId: number; email: string; name: string };
    output: { sentAt: string };
  };
}>();

// 4. Create async lock for write serialization (required for SQLite)
const lock = createAsyncLock();

// 5. Create state provider for sqlite3
type DbContext = { db: sqlite3.Database };

const stateProvider: SqliteStateProvider<DbContext> = {
  runInTransaction: async (fn) => {
    await lock.acquire();
    try {
      await promisify.exec(db, "BEGIN IMMEDIATE");
      try {
        const result = await fn({ db });
        await promisify.exec(db, "COMMIT");
        return result;
      } catch (error) {
        await promisify.exec(db, "ROLLBACK").catch(() => {});
        throw error;
      }
    } finally {
      lock.release();
    }
  },
  executeSql: async ({ txContext, sql, params, returns }) => {
    const database = txContext?.db ?? db;
    if (returns) {
      return promisify.all(database, sql, params);
    }
    await promisify.run(database, sql, params);
    return [];
  },
};

// 6. Create adapters and queuert client/worker
const stateAdapter = await createSqliteStateAdapter({ stateProvider });
await stateAdapter.migrateToLatest();

const notifyAdapter = createInProcessNotifyAdapter();

const qrtClient = await createQueuertClient({
  stateAdapter,
  notifyAdapter,
  registry,
});

// 7. Create and start qrtWorker
const qrtWorker = await createQueuertInProcessWorker({
  stateAdapter,
  notifyAdapter,
  registry,
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
});

const stopWorker = await qrtWorker.start();

// 8. Register a new user and queue welcome email atomically
const jobChain = await qrtClient.withNotify(async () => {
  await lock.acquire();
  try {
    await promisify.exec(db, "BEGIN IMMEDIATE");

    await promisify.run(db, "INSERT INTO users (name, email) VALUES (?, ?)", [
      "Alice",
      "alice@example.com",
    ]);
    const users = await promisify.all<{ id: number; name: string; email: string }>(
      db,
      "SELECT * FROM users WHERE email = ?",
      ["alice@example.com"],
    );
    const user = users[0];

    // Queue welcome email - if user creation fails, no email job is created
    const result = await qrtClient.startJobChain({
      db,
      typeName: "send_welcome_email",
      input: { userId: user.id, email: user.email, name: user.name },
    });

    await promisify.exec(db, "COMMIT");
    return result;
  } catch (error) {
    await promisify.exec(db, "ROLLBACK").catch(() => {});
    throw error;
  } finally {
    lock.release();
  }
});

// 9. Wait for the job chain to complete
const result = await qrtClient.waitForJobChainCompletion(jobChain, { timeoutMs: 1000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);

// 10. Cleanup
await stopWorker();
await new Promise<void>((resolve, reject) => {
  db.close((err) => {
    if (err) reject(err);
    else resolve();
  });
});
