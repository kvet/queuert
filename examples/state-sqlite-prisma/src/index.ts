import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
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

import { createPrismaSqliteStateProvider } from "./provider.js";

// 1. Create temp directory and set DATABASE_URL
const tempDir = mkdtempSync(join(tmpdir(), "queuert-sqlite-prisma-"));
const dbPath = join(tempDir, "test.db");

// 2. Initialize database with required pragmas before Prisma creates tables.
// auto_vacuum must be set before any tables exist; Prisma has no hook for this,
// so we create the file first with better-sqlite3.
const initDb = new Database(dbPath);
initDb.pragma("auto_vacuum = INCREMENTAL");
initDb.close();

// 3. Push Prisma schema to database and generate client
process.env.DATABASE_URL = `file:${dbPath}`;
execSync("npx prisma db push", {
  stdio: "inherit",
});

// Dynamic import after generate to get the freshly generated client
const { PrismaClient } = await import("../prisma/generated/prisma/client.js");

const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
const prisma = new PrismaClient({ adapter });

// 4. Create async RW lock for write serialization (SQLite requirement)
const lock = createAsyncRwLock();

// 5. Define job types
const jobTypes = defineJobTypes<{
  send_welcome_email: {
    entry: true;
    input: { userId: number; email: string; name: string };
    output: { sentAt: string };
  };
}>();

// 6. Create state provider for Prisma
const stateProvider = createPrismaSqliteStateProvider({ prisma: prisma as any, lock });

// 7. Create adapters and queuert client/worker
const stateAdapter = await createSqliteStateAdapter({
  stateProvider,
});
await stateAdapter.migrateToLatest();

const notifyAdapter = await createInProcessNotifyAdapter();

const client = await createClient({
  stateAdapter,
  notifyAdapter,
  jobTypes,
});

// 8. Create and start worker
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

const stopWorker = await worker.start();

// 9. Register a new user and queue welcome email atomically
const jobChain = await withTransactionHooks(async (transactionHooks) => {
  using _h = await lock.acquireWrite();
  return await prisma.$transaction(async (prisma) => {
    const user = await prisma.user.create({
      data: { name: "Alice", email: "alice@example.com" },
    });

    // Queue welcome email - if user creation fails, no email job is created
    return client.startJobChain({
      prisma,
      transactionHooks,
      typeName: "send_welcome_email",
      input: { userId: user.id, email: user.email, name: user.name },
    });
  });
});

// 10. Wait for the job chain to complete
const result = await client.awaitJobChain(jobChain, { timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);

// 11. Cleanup
await stopWorker();
await prisma.$disconnect();
rmSync(tempDir, { recursive: true, force: true });
