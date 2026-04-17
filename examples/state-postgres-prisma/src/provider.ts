import { type PgStateProvider } from "@queuert/postgres";

export type PrismaLikeClient = {
  $transaction: <T>(fn: (prisma: any) => Promise<T>) => Promise<T>;
  $queryRawUnsafe: (sql: string, ...params: unknown[]) => Promise<unknown[]>;
  $executeRawUnsafe: (sql: string, ...params: unknown[]) => Promise<unknown>;
};

export type PrismaPgContext<TPrisma> = { prisma: TPrisma };

export const createPrismaPgStateProvider = <TPrisma extends PrismaLikeClient>({
  prisma,
}: {
  prisma: TPrisma;
}): PgStateProvider<PrismaPgContext<TPrisma>> => {
  return {
    withTransaction: async (cb) => {
      return prisma.$transaction(async (prisma: TPrisma) => cb({ prisma }));
    },
    executeSql: async ({ txCtx, sql, params }) => {
      const prismaClient = (txCtx?.prisma ?? prisma) as PrismaLikeClient;

      if (params && params.length > 0) {
        return prismaClient.$queryRawUnsafe(sql, ...params);
      }

      const isSelect = /^\s*SELECT\b/i.test(sql);
      if (isSelect) {
        return prismaClient.$queryRawUnsafe(sql);
      }
      await prismaClient.$executeRawUnsafe(sql);
      return [];
    },
  };
};
