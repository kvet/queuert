import type { MysqlStateProvider } from "@queuert/mysql";
import { type TxHooks, withTxHooks } from "queuert";

type PrismaDriverAdapterError = {
  meta?: {
    driverAdapterError?: {
      cause?: { originalCode?: unknown; originalMessage?: unknown };
    };
  };
};

export type PrismaLikeClient = {
  $transaction: <T>(
    fn: (prisma: any) => Promise<T>,
    options: { isolationLevel: "ReadCommitted" },
  ) => Promise<T>;
  $queryRawUnsafe: (sql: string, ...params: unknown[]) => Promise<unknown[]>;
};

export type PrismaMysqlContext<TPrisma> = { prisma: TPrisma; txHooks: TxHooks };

export const createPrismaMysqlStateProvider = <TPrisma extends PrismaLikeClient>({
  prisma,
}: {
  prisma: TPrisma;
}): MysqlStateProvider<PrismaMysqlContext<TPrisma>> => {
  return {
    withTransaction: async (cb) =>
      withTxHooks(async (txHooks) =>
        prisma.$transaction(async (prisma: TPrisma) => cb({ prisma, txHooks }), {
          isolationLevel: "ReadCommitted",
        }),
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
      if (cause?.originalCode === "1213" || cause?.originalCode === "1020") {
        return { kind: "transaction_conflict" };
      }
      if (cause?.originalCode !== "1146") return undefined;
      const tableName = /Table '([^']+)' doesn't exist/.exec(String(cause.originalMessage))?.[1];
      return tableName === undefined ? undefined : { kind: "undefined_table", tableName };
    },
    executeSql: async ({ txCtx, sql, params }) => {
      const prismaClient = (txCtx?.prisma ?? prisma) as PrismaLikeClient;
      return prismaClient.$queryRawUnsafe(sql, ...params);
    },
  };
};
