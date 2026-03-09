import {
  type SqliteStateProvider,
  createAsyncLock,
  createSqliteStateAdapter,
} from "@queuert/sqlite";
import Database from "better-sqlite3";
import {
  createClient,
  createInProcessWorker,
  createJobTypeProcessorRegistry,
  defineJobTypeRegistry,
  withTransactionHooks,
} from "queuert";
import { createInProcessNotifyAdapter } from "queuert/internal";

// 1. Create in-memory SQLite database
const db = new Database(":memory:");
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
const registry = defineJobTypeRegistry<{
  send_welcome_email: {
    entry: true;
    input: { userId: number; email: string; name: string };
    output: { sentAt: string };
  };
}>();

// 4. Create state provider for better-sqlite3
type DbContext = { db: Database.Database };
const lock = createAsyncLock();

const stateProvider: SqliteStateProvider<DbContext> = {
  runInTransaction: async (fn) => {
    await lock.acquire();
    try {
      db.exec("BEGIN IMMEDIATE");
      const result = await fn({ db });
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
    } finally {
      lock.release();
    }
  },
  executeSql: async ({ txCtx, sql, params, returns }) => {
    const executeRaw = ({
      database,
      sql,
      params,
      returns,
    }: {
      database: Database.Database;
      sql: string;
      params?: unknown[];
      returns: boolean;
    }) => {
      if (returns) {
        const stmt = database.prepare(sql);
        return stmt.all(...(params ?? []));
      } else {
        if (params && params.length > 0) {
          const stmt = database.prepare(sql);
          stmt.run(...params);
        } else {
          database.exec(sql);
        }
        return [];
      }
    };

    if (txCtx) {
      return executeRaw({ database: txCtx.db, sql, params, returns });
    }

    await lock.acquire();
    try {
      return executeRaw({ database: db, sql, params, returns });
    } finally {
      lock.release();
    }
  },
};

// 5. Create adapters and queuert client/worker
const stateAdapter = await createSqliteStateAdapter({ stateProvider });
await stateAdapter.migrateToLatest();

const notifyAdapter = createInProcessNotifyAdapter();

const qrtClient = await createClient({
  stateAdapter,
  notifyAdapter,
  registry,
});

// 6. Create and start qrtWorker
const qrtWorker = await createInProcessWorker({
  client: qrtClient,
  processorRegistry: createJobTypeProcessorRegistry(qrtClient, registry, {
    send_welcome_email: {
      attemptHandler: async ({ job, complete }) => {
        // Simulate sending email (in real app, call email service here)
        console.log(`Sending welcome email to ${job.input.email} for ${job.input.name}`);

        return complete(async () => ({
          sentAt: new Date().toISOString(),
        }));
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
    if (db.inTransaction) {
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
const result = await qrtClient.awaitJobChain(jobChain, { timeoutMs: 1000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);

// 9. Cleanup
await stopWorker();
db.close();
