import { PrismaClient } from "@prisma/client";
import { createPgStateAdapter, PgStateProvider } from "@queuert/postgres";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { execSync } from "node:child_process";
import {
  createConsoleLog,
  createQueuertClient,
  createQueuertInProcessWorker,
  defineJobTypes,
} from "queuert";
import { createInProcessNotifyAdapter } from "queuert/internal";

// 1. Start PostgreSQL using testcontainers
const pgContainer = await new PostgreSqlContainer("postgres:14").withExposedPorts(5432).start();
const connectionString = pgContainer.getConnectionUri();

// 2. Push Prisma schema to database and create client
execSync("pnpm prisma db push --skip-generate", {
  env: { ...process.env, DATABASE_URL: connectionString },
  stdio: "inherit",
});

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: connectionString,
    },
  },
});

await prisma.$connect();

// 3. Define job types
const jobTypeRegistry = defineJobTypes<{
  add_pet_to_user: {
    entry: true;
    input: { userId: number; petName: string };
    output: { petId: number };
  };
}>();

// 4. Create state provider for Prisma
type PrismaTransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;
type DbContext = { prisma: PrismaTransactionClient };

const stateProvider: PgStateProvider<DbContext> = {
  runInTransaction: async (cb) => {
    return prisma.$transaction(async (prisma) => cb({ prisma }));
  },
  executeSql: async ({ txContext, sql, params }) => {
    const prismaClient = txContext?.prisma ?? prisma;

    if (params && params.length > 0) {
      return (prismaClient as any).$queryRawUnsafe(sql, ...params);
    }

    const isSelect = /^\s*SELECT\b/i.test(sql);
    if (isSelect) {
      return (prismaClient as any).$queryRawUnsafe(sql);
    }
    await (prismaClient as any).$executeRawUnsafe(sql);
    return [];
  },
};

// 5. Create adapters and queuert client/worker
const stateAdapter = await createPgStateAdapter({
  stateProvider,
  schema: "public",
  // Prisma v4+ removed implicit type coercion, so $queryRawUnsafe doesn't cast
  // string parameters to UUID, causing "operator does not exist: uuid = text".
  // Using TEXT is the recommended workaround. See: https://github.com/prisma/prisma/issues/16969
  idType: "text",
  idDefault: "gen_random_uuid()::text",
  $idType: "" as string,
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

// 6. Create and start qrtWorker
const qrtWorker = await createQueuertInProcessWorker({
  stateAdapter,
  notifyAdapter,
  log,
  jobTypeRegistry,
  jobTypeProcessors: {
    add_pet_to_user: {
      process: async ({ job, complete }) => {
        return complete(async ({ prisma }) => {
          const result = await prisma.pet.create({
            data: {
              ownerId: job.input.userId,
              name: job.input.petName,
            },
          });
          return { petId: result.id };
        });
      },
    },
  },
});

const stopWorker = await qrtWorker.start();

// 7. Create a user and queue a job atomically in the same transaction
const jobChain = await qrtClient.withNotify(async () =>
  prisma.$transaction(async (prisma) => {
    const user = await prisma.user.create({
      data: { name: "Alice" },
    });

    return qrtClient.startJobChain({
      prisma,
      typeName: "add_pet_to_user",
      input: { userId: user.id, petName: "Fluffy" },
    });
  }),
);

// 8. Wait for the job chain to complete
await qrtClient.waitForJobChainCompletion(jobChain, { timeoutMs: 1000 });

// 9. Cleanup
await stopWorker();
await prisma.$disconnect();
await pgContainer.stop();
