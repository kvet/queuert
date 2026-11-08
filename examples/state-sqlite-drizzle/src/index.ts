import { createAsyncRwLock, createSqliteStateAdapter } from "@queuert/sqlite";
import Database from "better-sqlite3";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import {
  createClient,
  createWorkerRunner,
  createProcessors,
  defineJobTypes,
  withTxHooks,
} from "queuert";

import { createDrizzleSqliteStateProvider } from "./provider.ts";

// Create in-memory SQLite database
const sqlite = new Database(":memory:");

// Define Drizzle schema
const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull(),
});

const schema = { users };

// Create Drizzle database connection
const db = drizzle(sqlite, { schema });

db.run(sql`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL
  )
`);

// Define job types
const jobTypes = defineJobTypes<{
  send_welcome_email: {
    entry: true;
    input: { userId: number };
    output: { sentAt: string };
  };
}>();

// Create state provider for Drizzle with better-sqlite3
// #region adapter
const lock = createAsyncRwLock();
const stateProvider = createDrizzleSqliteStateProvider({ db: sqlite, lock });
const stateAdapter = createSqliteStateAdapter({ stateProvider });
await stateAdapter.migrateToLatest();
// #endregion

const client = createClient({ stateAdapter, jobTypes });

const workerRunner = createWorkerRunner({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      send_welcome_email: {
        attemptHandler: async ({ job, complete }) => {
          let user: typeof users.$inferSelect | undefined;
          {
            using _h = await lock.acquireRead();
            user = db.select().from(users).where(eq(users.id, job.input.userId)).get();
          }
          if (!user) throw new Error(`User ${job.input.userId} not found`);

          // Simulate sending email (in real app, call email service here)
          console.log(`Sending welcome email to ${user.email} for ${user.name}`);

          return withTxHooks(async (txHooks) => {
            // The handler's transaction holds the provider's write lock, so the worker's
            // autocommit statements on this connection cannot run inside it.
            using _h = await lock.acquireWrite();
            sqlite.exec("BEGIN");
            try {
              const result = await complete({
                db: sqlite,
                txHooks,
                output: { sentAt: new Date().toISOString() },
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
            }
          });
        },
      },
    },
  }),
});

// Start worker runner
const stopWorkerRunner = await workerRunner.start();

// Register a new user and queue welcome email atomically
// #region create-chain
const chain = await withTxHooks(async (txHooks) => {
  using _h = await lock.acquireWrite();
  sqlite.exec("BEGIN");
  try {
    // Use Drizzle to insert the user
    const [user] = db
      .insert(users)
      .values({ name: "Alice", email: "alice@example.com" })
      .returning({ id: users.id })
      .all();

    // Queue welcome email - if user creation fails, no email job is created
    const result = await client.createChain({
      db: sqlite,
      txHooks,
      typeName: "send_welcome_email",
      input: { userId: user.id },
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
  }
});
// #endregion

// Wait for the chain to complete
const result = await client.awaitChain(chain, { timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);

// Cleanup
await stopWorkerRunner();
await stateAdapter.close();
sqlite.close();
