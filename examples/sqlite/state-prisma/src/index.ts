import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { createAsyncRwLock, createSqliteMigrator, createSqliteStateAdapter } from "@queuert/sqlite";
import {
  createClient,
  createWorkerRunner,
  createProcessors,
  defineJobTypes,
  withTxHooks,
} from "queuert";

import { createMigrations } from "./migrations.ts";
import { createPrismaSqliteStateProvider } from "./provider.ts";

await using drivers = new AsyncDisposableStack();
const tempDir = drivers.adopt(mkdtempSync(join(tmpdir(), "queuert-sqlite-prisma-")), (dir) => {
  rmSync(dir, { recursive: true, force: true });
});
const dbPath = join(tempDir, "test.db");

process.env.DATABASE_URL = `file:${dbPath}`;
execSync("npx prisma db push", {
  stdio: "inherit",
});

const { PrismaClient } = await import("../prisma/generated/prisma/client.ts");

const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
const prisma = drivers.adopt(new PrismaClient({ adapter }), async (prisma) => prisma.$disconnect());

const jobTypes = defineJobTypes<{
  "send-welcome-email": {
    entry: true;
    input: { userId: number };
    output: { sentAt: string };
  };
}>();

// #region adapter
const lock = createAsyncRwLock();
const stateProvider = createPrismaSqliteStateProvider({ prisma: prisma as any, lock });
await using stateAdapter = createSqliteStateAdapter({
  stateProvider,
});
await stateAdapter.migrateToLatest();
// #endregion

const migrator = createSqliteMigrator({
  stateProvider,
  migrations: createMigrations({ db: prisma, lock }),
});
const { applied } = await migrator.migrateToLatest();
console.log(`Applied application migrations: ${applied.join(", ")}`);
{
  using _h = await lock.acquireRead();
  assert.deepEqual(
    await prisma.$queryRaw`SELECT id, customer, status FROM invoices ORDER BY id`,
    [1, 2, 3, 4, 5].map((id) => ({ id, customer: `CUSTOMER-${id}`, status: "open" })),
  );
}

const client = createClient({ stateAdapter, jobTypes });

await using workerRunner = createWorkerRunner({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      "send-welcome-email": {
        attemptHandler: async ({ job, applyJobOutcome }) => {
          let user: { id: number; name: string; email: string } | null;
          {
            using _h = await lock.acquireRead();
            user = await prisma.user.findUnique({ where: { id: job.input.userId } });
          }
          if (!user) throw new Error(`User ${job.input.userId} not found`);

          console.log(`Sending welcome email to ${user.email} for ${user.name}`);

          await withTxHooks(async (txHooks) => {
            using _h = await lock.acquireWrite();
            return await prisma.$transaction(async (prisma) =>
              applyJobOutcome({ prisma, txHooks, output: { sentAt: new Date().toISOString() } }),
            );
          });
        },
      },
    },
  }),
});

await workerRunner.start();

// #region create-chain
const chain = await withTxHooks(async (txHooks) => {
  using _h = await lock.acquireWrite();
  return await prisma.$transaction(async (prisma) => {
    const user = await prisma.user.create({
      data: { name: "Alice", email: "alice@example.com" },
    });

    return client.createChain({
      prisma,
      txHooks,
      typeName: "send-welcome-email",
      input: { userId: user.id },
    });
  });
});
// #endregion

const result = await client.awaitChain({ chain, timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);
