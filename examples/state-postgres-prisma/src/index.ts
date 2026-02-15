import { PrismaPg } from "@prisma/adapter-pg";
import { type PgStateProvider, createPgStateAdapter } from "@queuert/postgres";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { execSync } from "node:child_process";
import { createClient, createInProcessWorker, defineJobTypes } from "queuert";
import { createInProcessNotifyAdapter } from "queuert/internal";

// 1. Start PostgreSQL using testcontainers
const pgContainer = await new PostgreSqlContainer("postgres:18").withExposedPorts(5432).start();
const connectionString = pgContainer.getConnectionUri();

// 2. Push Prisma schema to database and generate client
execSync("pnpm prisma db push", {
  env: { ...process.env, DATABASE_URL: connectionString },
  stdio: "inherit",
});

// Dynamic import after generate to get the freshly generated client
const { PrismaClient } = await import("../prisma/generated/prisma/client.js");

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

// 3. Define job types
const registry = defineJobTypes<{
  send_welcome_email: {
    entry: true;
    input: { userId: number; email: string; name: string };
    output: { sentAt: string };
  };
}>();

// 4. Create state provider for Prisma
type PrismaTransactionClient = Omit<
  InstanceType<typeof PrismaClient>,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends"
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

const qrtClient = await createClient({
  stateAdapter,
  notifyAdapter,
  registry,
});

// 6. Create and start qrtWorker
const qrtWorker = await createInProcessWorker({
  stateAdapter,
  notifyAdapter,
  registry,
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
});

const stopWorker = await qrtWorker.start();

// 7. Register a new user and queue welcome email atomically
const jobChain = await qrtClient.withNotify(async () =>
  prisma.$transaction(async (prisma) => {
    const user = await prisma.user.create({
      data: { name: "Alice", email: "alice@example.com" },
    });

    // Queue welcome email - if user creation fails, no email job is created
    return qrtClient.startJobChain({
      prisma,
      typeName: "send_welcome_email",
      input: { userId: user.id, email: user.email, name: user.name },
    });
  }),
);

// 8. Wait for the job chain to complete
const result = await qrtClient.waitForJobChainCompletion(jobChain, { timeoutMs: 1000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);

// 9. Cleanup
await stopWorker();
await prisma.$disconnect();
await pgContainer.stop();
