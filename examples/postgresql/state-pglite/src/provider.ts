import type { PGlite, Transaction } from "@electric-sql/pglite";
import type { PgStateProvider, RuntimeType } from "@queuert/postgres";
import { type TxHooks, withTxHooks } from "queuert";

export type PgliteContext = { pglite: PGlite | Transaction; txHooks: TxHooks };

export const createPgliteStateProvider = ({
  pglite,
}: {
  pglite: PGlite;
}): PgStateProvider<PgliteContext> => {
  const serializeParam = (value: unknown, type: RuntimeType | undefined): unknown => {
    if (value === undefined) return null;
    if (type === "jsonArray") return (value as unknown[]).map((el) => JSON.stringify(el));
    return value;
  };

  return {
    withTransaction: async (fn) =>
      withTxHooks(async (txHooks) => pglite.transaction(async (tx) => fn({ pglite: tx, txHooks }))),
    getTransaction: (txCtx) =>
      txCtx.pglite !== pglite && txCtx.txHooks.isOpen ? txCtx.txHooks : undefined,
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
      if (driverError?.code === "55P03") return { kind: "lock_not_available" };
      if (driverError?.code !== "42P01") return undefined;
      const tableName = /relation "([^"]+)" does not exist/.exec(String(driverError.message))?.[1];
      return tableName === undefined ? undefined : { kind: "undefined_table", tableName };
    },
    executeSql: async ({ txCtx, sql, params, paramTypes }) => {
      const serialized = params.map((value, i) => serializeParam(value, paramTypes[i]));
      return (await (txCtx?.pglite ?? pglite).query(sql, serialized)).rows;
    },
  };
};
