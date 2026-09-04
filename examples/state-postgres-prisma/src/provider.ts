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
    transactionConcurrency: "concurrent",
    withTransaction: async (cb) => {
      return prisma.$transaction(async (prisma: TPrisma) => cb({ prisma }));
    },
    // `id` not forwarded: Prisma's engine caches plans by SQL text per connection.
    executeSql: async ({ txCtx, sql, params, columnTypes }) => {
      const prismaClient = (txCtx?.prisma ?? prisma) as PrismaLikeClient;
      const result = await prismaClient.$queryRawUnsafe(sql, ...params);

      // Prisma returns BigInt for PostgreSQL bigint/count columns; narrow back
      // to number only for columns declared as numeric so string/json values
      // pass through.
      const numericColumns = Object.entries(columnTypes)
        .filter(([, type]) => type === "number" || type === "number?")
        .map(([name]) => name);
      if (numericColumns.length === 0) return result;

      return result.map((row) => {
        if (!row || typeof row !== "object") return row;
        const r = row as Record<string, unknown>;
        for (const col of numericColumns) {
          if (typeof r[col] === "bigint") r[col] = Number(r[col]);
        }
        return r;
      });
    },
  };
};
