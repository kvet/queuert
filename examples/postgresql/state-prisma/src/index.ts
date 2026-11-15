import assert from "node:assert/strict";
import { execSync } from "node:child_process";

import { PrismaPg } from "@prisma/adapter-pg";
import { createPgMigrator, createPgStateAdapter } from "@queuert/postgres";
import { acquirePostgres } from "@queuert/testcontainers";
import {
  createClient,
  createWorkerRunner,
  createProcessors,
  defineJobTypes,
  withTxHooks,
} from "queuert";

import { createMigrations } from "./migrations.ts";
import { createPrismaPgStateProvider } from "./provider.ts";

// Start PostgreSQL using testcontainers
await using pg = await acquirePostgres("postgres:18", import.meta.url);

// Push Prisma schema to database and generate client
execSync("npx prisma db push", {
  env: { ...process.env, DATABASE_URL: pg.connectionString },
  stdio: "inherit",
});

// Dynamic import after generate to get the freshly generated client
const { PrismaClient } = await import("../prisma/generated/prisma/client.ts");

await using drivers = new AsyncDisposableStack();
const adapter = new PrismaPg({ connectionString: pg.connectionString });
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
const stateProvider = createPrismaPgStateProvider({ prisma: prisma as any });
await using stateAdapter = createPgStateAdapter({
  stateProvider,
  // Prisma v4+ removed implicit type coercion, so $queryRawUnsafe doesn't cast
  // string parameters to UUID, causing "operator does not exist: uuid = text".
  // Using TEXT is the recommended workaround. See: https://github.com/prisma/prisma/issues/16969
  jobIdType: "text",
});
await stateAdapter.migrateToLatest();
// #endregion

const migrator = createPgMigrator({ stateProvider, migrations: createMigrations({ db: prisma }) });
const { applied } = await migrator.migrateToLatest();
console.log(`Applied application migrations: ${applied.join(", ")}`);

const openInvoices = await prisma.$queryRaw<{ customer: string }[]>`
  SELECT customer FROM invoices WHERE status = ${"open"} ORDER BY id
`;
assert.deepEqual(
  openInvoices.map((invoice) => invoice.customer),
  ["ACME", "GLOBEX", "INITECH"],
);

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
          const user = await prisma.user.findUniqueOrThrow({ where: { id: job.input.userId } });

          // Simulate sending email (in real app, call email service here)
          console.log(`Sending welcome email to ${user.email} for ${user.name}`);

          return withTxHooks(async (txHooks) =>
            prisma.$transaction(async (prisma) =>
              complete({ prisma, txHooks, output: { sentAt: new Date().toISOString() } }),
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
const result = await client.awaitChain(chain, { timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);
