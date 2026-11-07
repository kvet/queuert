import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { createAsyncRwLock, createSqliteStateAdapter } from "@queuert/sqlite";
import {
  createClient,
  createInProcessNotifyAdapter,
  createWorkerRunner,
  createProcessors,
  defineJobTypes,
  withTxHooks,
} from "queuert";

import { createPrismaSqliteStateProvider } from "./provider.ts";

// Create temp directory and set DATABASE_URL
const tempDir = mkdtempSync(join(tmpdir(), "queuert-sqlite-prisma-"));
const dbPath = join(tempDir, "test.db");

// Push Prisma schema to database and generate client
process.env.DATABASE_URL = `file:${dbPath}`;
execSync("npx prisma db push", {
  stdio: "inherit",
});

// Dynamic import after generate to get the freshly generated client
const { PrismaClient } = await import("../prisma/generated/prisma/client.ts");

const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
const prisma = new PrismaClient({ adapter });

// Define job types
const jobTypes = defineJobTypes<{
  send_welcome_email: {
    entry: true;
    input: { userId: number };
    output: { sentAt: string };
  };
}>();

// Create state provider for Prisma
// #region adapter
const lock = createAsyncRwLock();
const stateProvider = createPrismaSqliteStateProvider({ prisma: prisma as any, lock });
const stateAdapter = createSqliteStateAdapter({
  stateProvider,
});
await stateAdapter.migrateToLatest();
// #endregion

const notifyAdapter = createInProcessNotifyAdapter();

const client = createClient({
  stateAdapter,
  notifyAdapter,
  jobTypes,
});

// Create and start worker runner
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
            user = await prisma.user.findUnique({ where: { id: job.input.userId } });
          }
          if (!user) throw new Error(`User ${job.input.userId} not found`);

          // Simulate sending email (in real app, call email service here)
          console.log(`Sending welcome email to ${user.email} for ${user.name}`);

          return withTxHooks(async (txHooks) => {
            // The handler's transaction holds the provider's write lock, so the worker's
            // autocommit statements on this connection cannot run inside it.
            using _h = await lock.acquireWrite();
            return await prisma.$transaction(async (prisma) =>
              complete({ prisma, txHooks, output: { sentAt: new Date().toISOString() } }),
            );
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
  return await prisma.$transaction(async (prisma) => {
    const user = await prisma.user.create({
      data: { name: "Alice", email: "alice@example.com" },
    });

    // Queue welcome email - if user creation fails, no email job is created
    return client.createChain({
      prisma,
      txHooks,
      typeName: "send_welcome_email",
      input: { userId: user.id },
    });
  });
});
// #endregion

// Wait for the chain to complete
const result = await client.awaitChain(chain, { timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);

// Cleanup
await stopWorkerRunner();
await notifyAdapter.close();
await stateAdapter.close();
await prisma.$disconnect();
rmSync(tempDir, { recursive: true, force: true });
