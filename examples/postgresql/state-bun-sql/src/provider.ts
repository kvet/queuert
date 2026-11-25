import type { PgStateProvider, RuntimeType } from "@queuert/postgres";
import type { SQL, TransactionSQL } from "bun";
import { type TxHooks, withTxHooks } from "queuert";

export type BunSqlContext = { txSql: TransactionSQL; txHooks: TxHooks };

export const createBunSqlStateProvider = ({
  sql,
}: {
  sql: SQL;
}): PgStateProvider<BunSqlContext> => {
  type ArrayElement = string | number | boolean | bigint | Date | null | undefined;

  const toText = (value: ArrayElement): string | null => {
    if (value === undefined || value === null) return null;
    if (value instanceof Date) return value.toISOString();
    return String(value);
  };

  const toArrayLiteral = (values: (string | null)[]): string =>
    `{${values
      .map((value) =>
        value === null ? "NULL" : `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`,
      )
      .join(",")}}`;

  const serializeParam = (value: unknown, type: RuntimeType | undefined): unknown => {
    if (value === undefined || value === null) return null;
    if (type === "array") return toArrayLiteral((value as ArrayElement[]).map(toText));
    if (type === "jsonArray")
      return toArrayLiteral(
        (value as unknown[]).map((el) => (el === undefined ? null : JSON.stringify(el))),
      );
    if (type === "json" || type === "json?") return JSON.stringify(value);
    if (value instanceof Date) return value.toISOString();
    return value;
  };

  return {
    withTransaction: async (cb) =>
      withTxHooks(async (txHooks) => sql.begin(async (txSql) => cb({ txSql, txHooks }))),
    getTransaction: (txCtx) =>
      typeof txCtx.txSql.savepoint === "function" && txCtx.txHooks.isOpen
        ? txCtx.txHooks
        : undefined,
    onTransactionCommit: (txCtx, callback) => {
      txCtx.txHooks.onCommit(callback);
    },
    onTransactionRollback: (txCtx, callback) => {
      txCtx.txHooks.onRollback(callback);
    },
    classifyError: ({ error }) => {
      const driverError = error as { errno?: unknown; message?: unknown } | undefined;
      if (driverError?.errno === "40001" || driverError?.errno === "40P01")
        return { kind: "transaction_conflict" };
      if (driverError?.errno !== "42P01") return undefined;
      const tableName = /relation "([^"]+)" does not exist/.exec(String(driverError.message))?.[1];
      return tableName === undefined ? undefined : { kind: "undefined_table", tableName };
    },
    executeSql: async ({ txCtx, sql: query, params, paramTypes }) => {
      const client = txCtx?.txSql ?? sql;
      const serialized = (params ?? []).map((value, i) => serializeParam(value, paramTypes[i]));
      return client.unsafe(query, serialized);
    },
  };
};
