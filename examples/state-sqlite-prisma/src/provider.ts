import { type AsyncRwLock, type SqliteStateProvider } from "@queuert/sqlite";

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
  lock: AsyncRwLock;
}): SqliteStateProvider<PrismaSqliteContext<TPrisma>> => {
  return {
    withTransaction: async (cb) => {
      using _h = await lock.acquireWrite();
      return await prisma.$transaction(async (prisma: TPrisma) => cb({ prisma }));
    },
    // `id` not forwarded: Prisma's engine caches plans by SQL text per connection.
    executeSql: async ({ txCtx, sql, params, columnTypes, readOnly }) => {
      const runQuery = async (): Promise<unknown[]> => {
        const prismaClient = (txCtx?.prisma ?? prisma) as PrismaLikeClient;
        if (params && params.length > 0) {
          return prismaClient.$queryRawUnsafe(sql, ...params);
        }
        return prismaClient.$queryRawUnsafe(sql);
      };

      let result: unknown[];
      if (txCtx) {
        result = await runQuery();
      } else {
        using _h = readOnly ? await lock.acquireRead() : await lock.acquireWrite();
        result = await runQuery();
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
