import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { createAsyncRwLock, createSqliteStateAdapter } from "@queuert/sqlite";
import {
  createClient,
  createWorkerRunner,
  createProcessors,
  defineJobTypes,
  withTxHooks,
} from "queuert";

import { createPrismaSqliteStateProvider } from "./provider.ts";

// Create temp directory and set DATABASE_URL
await using drivers = new AsyncDisposableStack();
const tempDir = drivers.adopt(mkdtempSync(join(tmpdir(), "queuert-sqlite-prisma-")), (dir) => {
  rmSync(dir, { recursive: true, force: true });
});
const dbPath = join(tempDir, "test.db");

// Push Prisma schema to database and generate client
process.env.DATABASE_URL = `file:${dbPath}`;
execSync("npx prisma db push", {
  stdio: "inherit",
});

// Dynamic import after generate to get the freshly generated client
const { PrismaClient } = await import("../prisma/generated/prisma/client.ts");

const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
const prisma = drivers.adopt(new PrismaClient({ adapter }), async (prisma) => prisma.$disconnect());

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
await using stateAdapter = createSqliteStateAdapter({
  stateProvider,
});
await stateAdapter.migrateToLatest();
// #endregion

const client = createClient({ stateAdapter, jobTypes });

// Create and start worker runner
await using workerRunner = createWorkerRunner({
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

await workerRunner.start();

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
