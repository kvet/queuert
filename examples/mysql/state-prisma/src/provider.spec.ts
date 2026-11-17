import { execSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import {
  createMysqlMigratorConformanceContext,
  createMysqlStateProviderConformanceContext,
} from "@queuert/mysql/conformance";
import { acquireMysql, type MysqlConnectionOptions } from "@queuert/testcontainers";
import { afterAll, beforeAll, describe, test } from "vitest";

import { createPrismaMysqlStateProvider } from "./provider.ts";

const EXAMPLE_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

type PrismaLike = {
  $queryRawUnsafe: (sql: string, ...params: unknown[]) => Promise<unknown[]>;
  $transaction: <T>(fn: (prisma: any) => Promise<T>) => Promise<T>;
  $disconnect: () => Promise<void>;
};

const createPrisma = async (connectionOptions: MysqlConnectionOptions): Promise<PrismaLike> => {
  const { host, port, user, password, database } = connectionOptions;
  execSync("npx prisma db push", {
    cwd: EXAMPLE_DIR,
    env: {
      ...process.env,
      DATABASE_URL: `mysql://${user}:${password}@${host}:${port}/${database}`,
    },
    stdio: "inherit",
  });
  const { PrismaClient } = await import("../prisma/generated/prisma/client.ts");
  const adapter = new PrismaMariaDb({
    ...connectionOptions,
    connectionLimit: 20,
    allowPublicKeyRetrieval: true,
  });
  return new PrismaClient({ adapter });
};

// #region conformance
describe("mysql/state-prisma provider conformance", () => {
  let prisma: PrismaLike;
  const { context, cases } = createMysqlStateProviderConformanceContext({
    createStateProvider: async () => createPrismaMysqlStateProvider<PrismaLike>({ prisma }),
    dialect: "mysql",
    isolationLevel: "REPEATABLE READ",
    withNonTransactionContext: async (fn) => fn({ prisma }),
  });

  beforeAll(async () => {
    const { connectionOptions } = await acquireMysql("mysql:26", import.meta.url);
    prisma = await createPrisma(connectionOptions);
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  for (const conformanceCase of cases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
// #endregion

describe("mysql/state-prisma migrator conformance", () => {
  let prisma: PrismaLike;
  const { context, cases } = createMysqlMigratorConformanceContext({
    createStateProvider: () => createPrismaMysqlStateProvider<PrismaLike>({ prisma }),
  });

  beforeAll(async () => {
    const { connectionOptions } = await acquireMysql("mysql:26", `${import.meta.url}#migrator`);
    prisma = await createPrisma(connectionOptions);
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  for (const conformanceCase of cases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
