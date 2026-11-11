import { execSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaPg } from "@prisma/adapter-pg";
import {
  createPgMigratorConformanceContext,
  type PgMigratorConformanceContext,
  createPgStateProviderConformanceContext,
  type PgStateProviderConformanceContext,
  pgMigratorConformanceCases,
  pgStateProviderConformanceCases,
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
describe("state-postgres-prisma provider conformance", () => {
  let pg: AcquiredPostgres;
  let prisma: PrismaLike;
  let context: PgStateProviderConformanceContext;

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
    context = await createPgStateProviderConformanceContext({
      createStateProvider: async () => createPrismaPgStateProvider<PrismaLike>({ prisma }),
      withNonTransactionContext: async (fn) => fn({ prisma }),
    });
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await pg[Symbol.asyncDispose]();
  });

  for (const conformanceCase of pgStateProviderConformanceCases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
// #endregion

describe("state-postgres-prisma migrator conformance", () => {
  let pg: AcquiredPostgres;
  let prisma: PrismaLike;
  let context: PgMigratorConformanceContext;

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
    context = createPgMigratorConformanceContext({
      stateProvider: createPrismaPgStateProvider<PrismaLike>({ prisma }),
    });
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await pg[Symbol.asyncDispose]();
  });

  for (const conformanceCase of pgMigratorConformanceCases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
