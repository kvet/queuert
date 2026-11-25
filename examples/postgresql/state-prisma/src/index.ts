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

await using pg = await acquirePostgres("postgres:18", import.meta.url);

execSync("npx prisma db push", {
  env: { ...process.env, DATABASE_URL: pg.connectionString },
  stdio: "inherit",
});

const { PrismaClient } = await import("../prisma/generated/prisma/client.ts");

await using drivers = new AsyncDisposableStack();
const adapter = new PrismaPg({ connectionString: pg.connectionString });
const prisma = drivers.adopt(new PrismaClient({ adapter }), async (prisma) => prisma.$disconnect());

const jobTypes = defineJobTypes<{
  "send-welcome-email": {
    entry: true;
    input: { userId: number };
    output: { sentAt: string };
  };
}>();

// #region adapter
const stateProvider = createPrismaPgStateProvider({ prisma: prisma as any });
await using stateAdapter = createPgStateAdapter({
  stateProvider,
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
