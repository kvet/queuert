import type { AsyncRwLock, SqliteStateProvider } from "@queuert/sqlite";
import { type TxHooks, withTxHooks } from "queuert";

type PrismaDriverAdapterError = {
  meta?: { driverAdapterError?: { cause?: { kind?: unknown; table?: unknown } } };
};

export type PrismaLikeClient = {
  $transaction: <T>(fn: (prisma: any) => Promise<T>) => Promise<T>;
  $queryRawUnsafe: (sql: string, ...params: unknown[]) => Promise<unknown[]>;
};

export type PrismaSqliteContext<TPrisma> = { prisma: TPrisma; txHooks: TxHooks };

export const createPrismaSqliteStateProvider = <TPrisma extends PrismaLikeClient>({
  prisma,
  lock,
}: {
  prisma: TPrisma;
  lock: AsyncRwLock;
}): SqliteStateProvider<PrismaSqliteContext<TPrisma>> => {
  return {
    withTransaction: async (cb) =>
      withTxHooks(async (txHooks) => {
        using _h = await lock.acquireWrite();
        return await prisma.$transaction(async (prisma: TPrisma) => cb({ prisma, txHooks }));
      }),
    getTransaction: (txCtx) =>
      !("$connect" in txCtx.prisma) && txCtx.txHooks.isOpen ? txCtx.txHooks : undefined,
    onTransactionCommit: (txCtx, callback) => {
      txCtx.txHooks.onCommit(callback);
    },
    onTransactionRollback: (txCtx, callback) => {
      txCtx.txHooks.onRollback(callback);
    },
    classifyError: ({ error }) => {
      const cause = (error as PrismaDriverAdapterError | undefined)?.meta?.driverAdapterError
        ?.cause;
      return cause?.kind === "TableDoesNotExist" && typeof cause.table === "string"
        ? { kind: "undefined_table", tableName: cause.table }
        : undefined;
    },
    executeSql: async ({ txCtx, sql, params, columnTypes, readOnly }) => {
      const runQuery = async (): Promise<unknown[]> => {
        const prismaClient = (txCtx?.prisma ?? prisma) as PrismaLikeClient;
        return prismaClient.$queryRawUnsafe(sql, ...params);
      };

      let result: unknown[];
      if (txCtx) {
        result = await runQuery();
      } else {
        using _h = readOnly ? await lock.acquireRead() : await lock.acquireWrite();
        result = await runQuery();
      }

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
