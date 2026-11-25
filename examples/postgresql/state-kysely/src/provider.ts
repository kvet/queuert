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
      const driverError = error as { code?: unknown; message?: unknown } | undefined;
      if (driverError?.code === "40001" || driverError?.code === "40P01")
        return { kind: "transaction_conflict" };
      if (driverError?.code !== "42P01") return undefined;
      const tableName = /relation "([^"]+)" does not exist/.exec(String(driverError.message))?.[1];
      return tableName === undefined ? undefined : { kind: "undefined_table", tableName };
    },
    executeSql: async ({ txCtx, sql, params }) => {
      if (txCtx && !txCtx.db.isTransaction) {
        throw new Error("Provided context is not in a transaction");
      }
      const result = await (txCtx?.db ?? db).executeQuery(CompiledQuery.raw(sql, params));
      return result.rows;
    },
  };
};
