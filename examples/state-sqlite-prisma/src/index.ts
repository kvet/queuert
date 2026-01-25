import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import {
  type SqliteStateProvider,
  createAsyncLock,
  createSqliteStateAdapter,
} from "@queuert/sqlite";
import {
  createConsoleLog,
  createQueuertClient,
  createQueuertInProcessWorker,
  defineJobTypes,
} from "queuert";
import { createInProcessNotifyAdapter } from "queuert/internal";

// 1. Create temp directory and set DATABASE_URL
const tempDir = mkdtempSync(join(tmpdir(), "queuert-sqlite-prisma-"));
const dbPath = join(tempDir, "test.db");

// 2. Push Prisma schema to database and generate client
// Note: generate runs here because the module cache may have a stale client from another example
process.env.DATABASE_URL = `file:${dbPath}`;
execSync("pnpm prisma db push", {
  stdio: "inherit",
});

// Dynamic import after generate to get the freshly generated client
const { PrismaClient } = await import("@prisma/client");

const prisma = new PrismaClient();
await prisma.$connect();

// 3. Create async lock for write serialization (SQLite requirement)
const lock = createAsyncLock();

// 4. Define job types
const jobTypeRegistry = defineJobTypes<{
  send_welcome_email: {
    entry: true;
    input: { userId: number; email: string; name: string };
    output: { sentAt: string };
  };
}>();

// 5. Create state provider for Prisma
type PrismaTransactionClient = Omit<
  InstanceType<typeof PrismaClient>,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;
type DbContext = { prisma: PrismaTransactionClient };

// Prisma returns BigInt for SQLite integers, but queuert expects numbers
const convertBigInts = (rows: unknown[]): unknown[] => {
  return rows.map((row) => {
    if (row && typeof row === "object") {
      const converted: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) {
        converted[key] = typeof value === "bigint" ? Number(value) : value;
      }
      return converted;
    }
    return row;
  });
};

const stateProvider: SqliteStateProvider<DbContext> = {
  runInTransaction: async (cb) => {
    await lock.acquire();
    try {
      return await prisma.$transaction(async (prisma) => cb({ prisma }));
    } finally {
      lock.release();
    }
  },
  executeSql: async ({ txContext, sql, params, returns }) => {
    const prismaClient = txContext?.prisma ?? prisma;

    if (returns) {
      let result: unknown[];
      if (params && params.length > 0) {
        result = await (prismaClient as any).$queryRawUnsafe(sql, ...params);
      } else {
        result = await (prismaClient as any).$queryRawUnsafe(sql);
      }
      return convertBigInts(result);
    }

    if (params && params.length > 0) {
      await (prismaClient as any).$executeRawUnsafe(sql, ...params);
    } else {
      await (prismaClient as any).$executeRawUnsafe(sql);
    }
    return [];
  },
};

// 6. Create adapters and queuert client/worker
const stateAdapter = await createSqliteStateAdapter({
  stateProvider,
});
await stateAdapter.migrateToLatest();

const notifyAdapter = createInProcessNotifyAdapter();
const log = createConsoleLog();

const qrtClient = await createQueuertClient({
  stateAdapter,
  notifyAdapter,
  log,
  jobTypeRegistry,
});

// 7. Create and start qrtWorker
const qrtWorker = await createQueuertInProcessWorker({
  stateAdapter,
  notifyAdapter,
  log,
  jobTypeRegistry,
  jobTypeProcessors: {
    send_welcome_email: {
      process: async ({ job, complete }) => {
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
    return await prisma.$transaction(async (prisma) => {
      const user = await prisma.user.create({
        data: { name: "Alice", email: "alice@example.com" },
      });

      // Queue welcome email - if user creation fails, no email job is created
      return qrtClient.startJobChain({
        prisma,
        typeName: "send_welcome_email",
        input: { userId: user.id, email: user.email, name: user.name },
      });
    });
  } finally {
    lock.release();
  }
});

// 9. Wait for the job chain to complete
const result = await qrtClient.waitForJobChainCompletion(jobChain, { timeoutMs: 1000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);

// 10. Cleanup
await stopWorker();
await prisma.$disconnect();
rmSync(tempDir, { recursive: true, force: true });
