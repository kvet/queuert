import type { SqliteStateProvider } from "@queuert/sqlite";
import { CompiledQuery, type Kysely } from "kysely";
import { type TxHooks, withTxHooks } from "queuert";

export type KyselySqliteContext<TDatabase> = { db: Kysely<TDatabase>; txHooks: TxHooks };

export const createKyselySqliteStateProvider = <TDatabase>({
  db,
}: {
  db: Kysely<TDatabase>;
}): SqliteStateProvider<KyselySqliteContext<TDatabase>> => {
  return {
    withTransaction: async (cb) =>
      withTxHooks(async (txHooks) =>
        db.transaction().execute(async (txDb) => cb({ db: txDb, txHooks })),
      ),
    getTransaction: (txCtx) =>
      txCtx.db.isTransaction && txCtx.txHooks.isOpen ? txCtx.txHooks : undefined,
    onTransactionCommit: (txCtx, callback) => {
      txCtx.txHooks.onCommit(callback);
    },
    onTransactionRollback: (txCtx, callback) => {
      txCtx.txHooks.onRollback(callback);
    },
    classifyError: ({ error }) => {
      const tableName = /no such table: (\S+)/.exec(
        String((error as { message?: unknown } | undefined)?.message),
      )?.[1];
      return tableName === undefined ? undefined : { kind: "undefined_table", tableName };
    },
    executeSql: async ({ txCtx, sql, params }) => {
      const database = txCtx?.db ?? db;
      const result = await database.executeQuery(CompiledQuery.raw(sql, params));
      return result.rows;
    },
  };
};
