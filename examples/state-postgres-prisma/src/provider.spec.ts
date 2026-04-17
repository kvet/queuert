import { execSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaPg } from "@prisma/adapter-pg";
import { createPgStateAdapter } from "@queuert/postgres";
import { acquirePostgres } from "@queuert/testcontainers";
import { runStateAdapterConformance } from "queuert/conformance";
import { test } from "vitest";

import { type PrismaPgContext, createPrismaPgStateProvider } from "./provider.js";

const EXAMPLE_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

type PrismaLike = {
  $executeRawUnsafe: (sql: string) => Promise<unknown>;
  $queryRawUnsafe: (sql: string, ...params: unknown[]) => Promise<unknown[]>;
  $transaction: <T>(fn: (prisma: any) => Promise<T>) => Promise<T>;
  $disconnect: () => Promise<void>;
};

test("state-postgres-prisma provider passes state adapter conformance", async () => {
  await using pg = await acquirePostgres("postgres:18", import.meta.url);

  await runStateAdapterConformance(async () => {
    execSync("npx prisma db push", {
      cwd: EXAMPLE_DIR,
      env: { ...process.env, DATABASE_URL: pg.connectionString },
      stdio: "inherit",
    });

    const { PrismaClient } = await import("../prisma/generated/prisma/client.js");
    const prismaAdapter = new PrismaPg({ connectionString: pg.connectionString });
    const prisma = new PrismaClient({ adapter: prismaAdapter }) as unknown as PrismaLike;

    const stateProvider = createPrismaPgStateProvider<PrismaLike>({ prisma });
    const adapter = await createPgStateAdapter({
      stateProvider,
      idType: "text",
      idDefault: "gen_random_uuid()::text",
      $idType: "" as string,
    });
    await adapter.migrateToLatest();

    return {
      stateAdapter: adapter,
      poisonTransaction: async (txCtx: PrismaPgContext<PrismaLike>) => {
        await txCtx.prisma.$queryRawUnsafe("SELECT 1 FROM nonexistent_table_queuert_poison_xyz");
      },
      reset: async () => adapter.truncate(),
      dispose: async () => {
        await prisma.$disconnect();
      },
    };
  });
}, 60_000);
