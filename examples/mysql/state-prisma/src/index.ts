import { execSync } from "node:child_process";

import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { createMysqlMigrator, createMysqlStateAdapter } from "@queuert/mysql";
import { acquireMysql } from "@queuert/testcontainers";
import {
  createClient,
  createWorkerRunner,
  createProcessors,
  defineJobTypes,
  withTxHooks,
} from "queuert";

import { createMigrations } from "./migrations.ts";
import { createPrismaMysqlStateProvider } from "./provider.ts";

// Start MySQL using testcontainers
await using mysql = await acquireMysql("mysql:26", import.meta.url);
const { host, port, user, password, database } = mysql.connectionOptions;

// Push Prisma schema to database
execSync("npx prisma db push", {
  env: { ...process.env, DATABASE_URL: `mysql://${user}:${password}@${host}:${port}/${database}` },
  stdio: "inherit",
});

// Dynamic import after generate to get the freshly generated client
const { PrismaClient } = await import("../prisma/generated/prisma/client.ts");

await using drivers = new AsyncDisposableStack();
const adapter = new PrismaMariaDb({
  ...mysql.connectionOptions,
  connectionLimit: 10,
  allowPublicKeyRetrieval: true,
});
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
const stateProvider = createPrismaMysqlStateProvider({ prisma: prisma as any });
await using stateAdapter = createMysqlStateAdapter({ stateProvider, dialect: "mysql" });
await stateAdapter.migrateToLatest();
// #endregion

// Run the application's own migrations with the same migrator
const { applied } = await createMysqlMigrator({
  stateProvider,
  migrations: createMigrations({ db: prisma }),
}).migrateToLatest();
console.log(`Applied app migrations: ${applied.join(", ")}`);

const client = createClient({ stateAdapter, jobTypes });

// Create and start worker runner
await using workerRunner = createWorkerRunner({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      send_welcome_email: {
        attemptHandler: async ({ job, applyOutcome }) => {
          const user = await prisma.user.findUniqueOrThrow({ where: { id: job.input.userId } });

          // Simulate sending email (in real app, call email service here)
          console.log(`Sending welcome email to ${user.email} for ${user.name}`);

          return withTxHooks(async (txHooks) =>
            prisma.$transaction(async (prisma) =>
              applyOutcome({ prisma, txHooks, output: { sentAt: new Date().toISOString() } }),
            ),
          );
        },
      },
    },
  }),
});

await workerRunner.start();

// Register a new user and queue welcome email atomically
const chain = await withTxHooks(async (txHooks) =>
  prisma.$transaction(async (prisma) => {
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
  }),
);

// Wait for the chain to complete
const result = await client.awaitChain({ chain, timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);
