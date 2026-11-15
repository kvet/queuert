import type { MysqlStateProvider } from "@queuert/mysql";
import { CompiledQuery, type Kysely } from "kysely";
import { type TxHooks, withTxHooks } from "queuert";

export type KyselyMysqlContext<TDatabase> = { db: Kysely<TDatabase>; txHooks: TxHooks };

export const createKyselyMysqlStateProvider = <TDatabase>({
  db,
}: {
  db: Kysely<TDatabase>;
}): MysqlStateProvider<KyselyMysqlContext<TDatabase>> => {
  return {
    withTransaction: async (cb) =>
      withTxHooks(async (txHooks) =>
        db
          .transaction()
          .setIsolationLevel("read committed")
          .execute(async (txDb) => cb({ db: txDb, txHooks })),
      ),
    isTransaction: (txCtx) => txCtx.db.isTransaction,
    onTransactionCommit: (txCtx, callback) => {
      txCtx.txHooks.onCommit(callback);
    },
    onTransactionRollback: (txCtx, callback) => {
      txCtx.txHooks.onRollback(callback);
    },
    classifyError: ({ error }) => {
      const driverError = error as { errno?: unknown; message?: unknown } | undefined;
      switch (driverError?.errno) {
        case 1146: {
          const tableName = /Table '([^']+)' doesn't exist/.exec(String(driverError.message))?.[1];
          return tableName === undefined ? undefined : { kind: "undefined_table", tableName };
        }
        default:
          return undefined;
      }
    },
    // `id` not forwarded: Kysely's MySQL dialect sends every query with mysql2's `query`
    // (text protocol). Bypass Kysely for server-side prepared statements (see mysql/state-mysql2).
    executeSql: async ({ txCtx, sql, params }) => {
      if (txCtx && !txCtx.db.isTransaction) {
        throw new Error("Provided context is not in a transaction");
      }
      const result = await (txCtx?.db ?? db).executeQuery(CompiledQuery.raw(sql, params));
      return result.rows;
    },
  };
};
