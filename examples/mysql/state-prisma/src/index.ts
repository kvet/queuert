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

await using mysql = await acquireMysql("mysql:26", import.meta.url);
const { host, port, user, password, database } = mysql.connectionOptions;

execSync("npx prisma db push", {
  env: { ...process.env, DATABASE_URL: `mysql://${user}:${password}@${host}:${port}/${database}` },
  stdio: "inherit",
});

const { PrismaClient } = await import("../prisma/generated/prisma/client.ts");

await using drivers = new AsyncDisposableStack();
const adapter = new PrismaMariaDb({
  ...mysql.connectionOptions,
  connectionLimit: 10,
  allowPublicKeyRetrieval: true,
});
const prisma = drivers.adopt(new PrismaClient({ adapter }), async (prisma) => prisma.$disconnect());

const jobTypes = defineJobTypes<{
  "send-welcome-email": {
    entry: true;
    input: { userId: number };
    output: { sentAt: string };
  };
}>();

// #region adapter
const stateProvider = createPrismaMysqlStateProvider({ prisma: prisma as any });
await using stateAdapter = createMysqlStateAdapter({ stateProvider, dialect: "mysql" });
await stateAdapter.migrateToLatest();
// #endregion

const { applied } = await createMysqlMigrator({
  stateProvider,
  migrations: createMigrations({ db: prisma }),
}).migrateToLatest();
console.log(`Applied app migrations: ${applied.join(", ")}`);

const client = createClient({ stateAdapter, jobTypes });

await using workerRunner = createWorkerRunner({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      "send-welcome-email": {
        attemptHandler: async ({ job, applyJobOutcome }) => {
          const user = await prisma.user.findUniqueOrThrow({ where: { id: job.input.userId } });

          console.log(`Sending welcome email to ${user.email} for ${user.name}`);

          await withTxHooks(async (txHooks) =>
            prisma.$transaction(async (prisma) =>
              applyJobOutcome({ prisma, txHooks, output: { sentAt: new Date().toISOString() } }),
            ),
          );
        },
      },
    },
  }),
});

await workerRunner.start();

const chain = await withTxHooks(async (txHooks) =>
  prisma.$transaction(async (prisma) => {
    const user = await prisma.user.create({
      data: { name: "Alice", email: "alice@example.com" },
    });

    return client.createChain({
      prisma,
      txHooks,
      typeName: "send-welcome-email",
      input: { userId: user.id },
    });
  }),
);

const result = await client.awaitChain({ chain, timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);
