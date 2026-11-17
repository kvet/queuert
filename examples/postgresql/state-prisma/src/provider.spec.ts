import { execSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaPg } from "@prisma/adapter-pg";
import {
  createPgMigratorConformanceContext,
  createPgStateProviderConformanceContext,
} from "@queuert/postgres/conformance";
import { acquirePostgres, type AcquiredPostgres } from "@queuert/testcontainers";
import { afterAll, beforeAll, describe, test } from "vitest";

import { createPrismaPgStateProvider } from "./provider.ts";

const EXAMPLE_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

type PrismaLike = {
  $executeRawUnsafe: (sql: string) => Promise<unknown>;
  $queryRawUnsafe: (sql: string, ...params: unknown[]) => Promise<unknown[]>;
  $transaction: <T>(fn: (prisma: any) => Promise<T>) => Promise<T>;
  $disconnect: () => Promise<void>;
};

// #region conformance
describe("postgresql/state-prisma provider conformance", () => {
  let pg: AcquiredPostgres;
  let prisma: PrismaLike;
  const { context, cases } = createPgStateProviderConformanceContext({
    isolationLevel: "READ COMMITTED",
    createStateProvider: async () => createPrismaPgStateProvider<PrismaLike>({ prisma }),
    withNonTransactionContext: async (fn) => fn({ prisma }),
  });

  beforeAll(async () => {
    pg = await acquirePostgres("postgres:18", import.meta.url);
    execSync("npx prisma db push", {
      cwd: EXAMPLE_DIR,
      env: { ...process.env, DATABASE_URL: pg.connectionString },
      stdio: "inherit",
    });
    const { PrismaClient } = await import("../prisma/generated/prisma/client.ts");
    const prismaAdapter = new PrismaPg({ connectionString: pg.connectionString });
    prisma = new PrismaClient({ adapter: prismaAdapter });
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await pg[Symbol.asyncDispose]();
  });

  for (const conformanceCase of cases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
// #endregion

describe("postgresql/state-prisma migrator conformance", () => {
  let pg: AcquiredPostgres;
  let prisma: PrismaLike;
  const { context, cases } = createPgMigratorConformanceContext({
    createStateProvider: () => createPrismaPgStateProvider<PrismaLike>({ prisma }),
  });

  beforeAll(async () => {
    pg = await acquirePostgres("postgres:18", `${import.meta.url}#migrator`);
    execSync("npx prisma db push", {
      cwd: EXAMPLE_DIR,
      env: { ...process.env, DATABASE_URL: pg.connectionString },
      stdio: "inherit",
    });
    const { PrismaClient } = await import("../prisma/generated/prisma/client.ts");
    const prismaAdapter = new PrismaPg({ connectionString: pg.connectionString });
    prisma = new PrismaClient({ adapter: prismaAdapter });
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await pg[Symbol.asyncDispose]();
  });

  for (const conformanceCase of cases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
