import { PrismaClient } from "@prisma/client";
import { createPgStateAdapter, PgStateProvider } from "@queuert/postgres";
import { createConsoleLog, createQueuert } from "queuert";
import { createInProcessNotifyAdapter } from "queuert/internal";
import { PrismaTransactionClient } from "./prisma.js";
import { qrtJobTypeDefinitions } from "./qrt-schema.js";

export const createQrt = async ({ prisma }: { prisma: PrismaClient }) => {
  const stateProvider: PgStateProvider<{ prisma: PrismaTransactionClient }> = {
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
  const stateAdapter = await createPgStateAdapter({
    stateProvider,
    schema: "public",
    // Prisma v4+ removed implicit type coercion, so $queryRawUnsafe doesn't cast
    // string parameters to UUID, causing "operator does not exist: uuid = text".
    // Using TEXT is the recommended workaround. See: https://github.com/prisma/prisma/issues/16969
    idType: "text",
    idDefault: "gen_random_uuid()::text",
  });

  await stateAdapter.migrateToLatest();

  const notifyAdapter = createInProcessNotifyAdapter();

  return createQueuert({
    stateAdapter,
    notifyAdapter,
    log: createConsoleLog(),
    jobTypeRegistry: qrtJobTypeDefinitions,
  });
};

export type Qrt = Awaited<ReturnType<typeof createQrt>>;
