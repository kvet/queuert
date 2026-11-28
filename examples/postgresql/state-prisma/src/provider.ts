import type { PgStateProvider } from "@queuert/postgres";
import { type TxHooks, withTxHooks } from "queuert";

type PrismaDriverAdapterError = {
  meta?: {
    driverAdapterError?: {
      cause?: { originalCode?: unknown; originalMessage?: unknown; table?: unknown };
    };
  };
};

export type PrismaLikeClient = {
  $transaction: <T>(
    fn: (prisma: any) => Promise<T>,
    options?: Record<string, unknown>,
  ) => Promise<T>;
  $queryRawUnsafe: (sql: string, ...params: unknown[]) => Promise<unknown[]>;
  $executeRawUnsafe: (sql: string, ...params: unknown[]) => Promise<unknown>;
};

export type PrismaPgContext<TPrisma> = { prisma: TPrisma; txHooks: TxHooks };

export const createPrismaPgStateProvider = <TPrisma extends PrismaLikeClient>({
  prisma,
}: {
  prisma: TPrisma;
}): PgStateProvider<PrismaPgContext<TPrisma>> => {
  return {
    withTransaction: async (cb) =>
      withTxHooks(async (txHooks) =>
        prisma.$transaction(async (prisma: TPrisma) => cb({ prisma, txHooks })),
      ),
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
      if (cause?.originalCode === "40001" || cause?.originalCode === "40P01")
        return { kind: "transaction_conflict" };
      if (cause?.originalCode === "55P03") return { kind: "lock_not_available" };
      if (cause?.originalCode !== "42P01") return undefined;
      const tableName =
        typeof cause.table === "string"
          ? cause.table
          : /relation "([^"]+)" does not exist/.exec(String(cause.originalMessage))?.[1];
      return tableName === undefined ? undefined : { kind: "undefined_table", tableName };
    },
    executeSql: async ({ txCtx, sql, params, columnTypes }) => {
      const prismaClient = (txCtx?.prisma ?? prisma) as PrismaLikeClient;
      const result = await prismaClient.$queryRawUnsafe(sql, ...params);

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
