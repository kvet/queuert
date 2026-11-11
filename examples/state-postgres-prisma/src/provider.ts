import type { PgStateProvider } from "@queuert/postgres";
import { type TxHooks, withTxHooks } from "queuert";

// Prisma wraps a raw query's driver error; the SQLSTATE is `originalCode` on its cause.
type PrismaDriverAdapterError = {
  meta?: {
    driverAdapterError?: {
      cause?: { originalCode?: unknown; originalMessage?: unknown; table?: unknown };
    };
  };
};

export type PrismaLikeClient = {
  $transaction: <T>(fn: (prisma: any) => Promise<T>) => Promise<T>;
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
    // Prisma hides `$connect` on the interactive transaction client.
    isTransaction: (txCtx) => !("$connect" in txCtx.prisma),
    onTransactionCommit: (txCtx, callback) => {
      txCtx.txHooks.onCommit(callback);
    },
    onTransactionRollback: (txCtx, callback) => {
      txCtx.txHooks.onRollback(callback);
    },
    classifyError: ({ error }) => {
      const cause = (error as PrismaDriverAdapterError | undefined)?.meta?.driverAdapterError
        ?.cause;
      if (cause?.originalCode !== "42P01") return undefined;
      const tableName =
        typeof cause.table === "string"
          ? cause.table
          : /relation "([^"]+)" does not exist/.exec(String(cause.originalMessage))?.[1];
      return tableName === undefined ? undefined : { kind: "undefined_table", tableName };
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
