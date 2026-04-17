import { type AsyncLock, type SqliteStateProvider } from "@queuert/sqlite";

export type PrismaLikeClient = {
  $transaction: <T>(fn: (prisma: any) => Promise<T>) => Promise<T>;
  $queryRawUnsafe: (sql: string, ...params: unknown[]) => Promise<unknown[]>;
};

export type PrismaSqliteContext<TPrisma> = { prisma: TPrisma };

export const createPrismaSqliteStateProvider = <TPrisma extends PrismaLikeClient>({
  prisma,
  lock,
}: {
  prisma: TPrisma;
  lock: AsyncLock;
}): SqliteStateProvider<PrismaSqliteContext<TPrisma>> => {
  return {
    withTransaction: async (cb) => {
      await lock.acquire();
      try {
        return await prisma.$transaction(async (prisma: TPrisma) => cb({ prisma }));
      } finally {
        lock.release();
      }
    },
    executeSql: async ({ txCtx, sql, params, columnTypes }) => {
      const prismaClient = (txCtx?.prisma ?? prisma) as PrismaLikeClient;

      let result: unknown[];
      if (params && params.length > 0) {
        result = await prismaClient.$queryRawUnsafe(sql, ...params);
      } else {
        result = await prismaClient.$queryRawUnsafe(sql);
      }

      // Prisma returns BigInt for SQLite INTEGER columns; narrow back to number
      // only for columns declared as numeric so string/json values pass through.
      const numericColumns = Object.entries(columnTypes)
        .filter(([, type]) => type === "number" || type === "number?")
        .map(([name]) => name);
      if (numericColumns.length === 0) return result;

      return result.map((row) => {
        if (!row || typeof row !== "object") return row;
        const source = row as Record<string, unknown>;
        const converted: Record<string, unknown> = { ...source };
        for (const col of numericColumns) {
          const value = source[col];
          if (typeof value === "bigint") converted[col] = Number(value);
        }
        return converted;
      });
    },
  };
};
