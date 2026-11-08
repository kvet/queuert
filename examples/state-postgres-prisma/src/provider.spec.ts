import { execSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaPg } from "@prisma/adapter-pg";
import { runPgStateProviderConformance } from "@queuert/postgres/conformance";
import { acquirePostgres } from "@queuert/testcontainers";
import { test } from "vitest";

import { createPrismaPgStateProvider } from "./provider.ts";

const EXAMPLE_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

type PrismaLike = {
  $executeRawUnsafe: (sql: string) => Promise<unknown>;
  $queryRawUnsafe: (sql: string, ...params: unknown[]) => Promise<unknown[]>;
  $transaction: <T>(fn: (prisma: any) => Promise<T>) => Promise<T>;
  $disconnect: () => Promise<void>;
};

// #region conformance
test("state-postgres-prisma provider passes state provider conformance", async () => {
  await using pg = await acquirePostgres("postgres:18", import.meta.url);

  await runPgStateProviderConformance(async () => {
    execSync("npx prisma db push", {
      cwd: EXAMPLE_DIR,
      env: { ...process.env, DATABASE_URL: pg.connectionString },
      stdio: "inherit",
    });

    const { PrismaClient } = await import("../prisma/generated/prisma/client.ts");
    const prismaAdapter = new PrismaPg({ connectionString: pg.connectionString });
    const prisma = new PrismaClient({ adapter: prismaAdapter }) as unknown as PrismaLike;

    const stateProvider = createPrismaPgStateProvider<PrismaLike>({ prisma });

    return {
      stateProvider,
      withNonTransactionContext: async (fn) => fn({ prisma }),
      dispose: async () => {
        await prisma.$disconnect();
      },
    };
  });
}, 60_000);
// #endregion
