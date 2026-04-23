import { createAsyncLock, createSqliteStateAdapter } from "@queuert/sqlite";
import Database from "better-sqlite3";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import {
  createClient,
  createInProcessWorker,
  createProcessors,
  defineJobTypes,
  withTransactionHooks,
  createInProcessNotifyAdapter,
} from "queuert";

import { createDrizzleSqliteStateProvider } from "./provider.js";

// 1. Create in-memory SQLite database
const sqlite = new Database(":memory:");
sqlite.pragma("auto_vacuum = INCREMENTAL");
sqlite.pragma("foreign_keys = ON");

// 2. Define Drizzle schema
const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull(),
});

const schema = { users };

// 3. Create Drizzle database connection
const db = drizzle(sqlite, { schema });

db.run(sql`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL
  )
`);

// 4. Define job types
const jobTypes = defineJobTypes<{
  send_welcome_email: {
    entry: true;
    input: { userId: number; email: string; name: string };
    output: { sentAt: string };
  };
}>();

// 5. Create state provider for Drizzle with better-sqlite3
const lock = createAsyncLock();
const stateProvider = createDrizzleSqliteStateProvider({ db: sqlite, lock });

// 6. Create adapters and queuert client/worker
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

// 7. Start worker
const stopWorker = await worker.start();

// 8. Register a new user and queue welcome email atomically
const jobChain = await withTransactionHooks(async (transactionHooks) => {
  await lock.acquire();
  try {
    sqlite.exec("BEGIN IMMEDIATE");

    // Use Drizzle to insert the user
    const [user] = db
      .insert(users)
      .values({ name: "Alice", email: "alice@example.com" })
      .returning()
      .all();

    // Queue welcome email - if user creation fails, no email job is created
    const result = await client.startJobChain({
      db: sqlite,
      transactionHooks,
      typeName: "send_welcome_email",
      input: { userId: user.id, email: user.email, name: user.name },
    });

    sqlite.exec("COMMIT");
    return result;
  } catch (error) {
    if (sqlite.inTransaction) {
      try {
        sqlite.exec("ROLLBACK");
      } catch {
        // ignore rollback errors
      }
    }
    throw error;
  } finally {
    lock.release();
  }
});

// 9. Wait for the job chain to complete
const result = await client.awaitJobChain(jobChain, { timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);

// 10. Cleanup
await stopWorker();
sqlite.close();
