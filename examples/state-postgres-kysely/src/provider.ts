import type { PgStateProvider } from "@queuert/postgres";
import { CompiledQuery, type Kysely } from "kysely";
import { type TxHooks, withTxHooks } from "queuert";

export type KyselyPgContext<TDatabase> = { db: Kysely<TDatabase>; txHooks: TxHooks };

export const createKyselyPgStateProvider = <TDatabase>({
  db,
}: {
  db: Kysely<TDatabase>;
}): PgStateProvider<KyselyPgContext<TDatabase>> => {
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
      const driverError = error as { code?: unknown; message?: unknown } | undefined;
      if (driverError?.code !== "42P01") return undefined;
      const tableName = /relation "([^"]+)" does not exist/.exec(String(driverError.message))?.[1];
      return tableName === undefined ? undefined : { kind: "undefined_table", tableName };
    },
    // `id` not forwarded: Kysely's CompiledQuery.raw has no name field; the pg
    // dialect calls `client.query(sql, params)` unprepared. Bypass Kysely for
    // server-side prepared statements (see state-postgres-pg).
    executeSql: async ({ txCtx, sql, params }) => {
      if (txCtx && !txCtx.db.isTransaction) {
        throw new Error("Provided context is not in a transaction");
      }
      const result = await (txCtx?.db ?? db).executeQuery(CompiledQuery.raw(sql, params));
      return result.rows;
    },
  };
};
