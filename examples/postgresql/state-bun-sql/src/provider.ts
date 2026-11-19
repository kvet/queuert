import type { PgStateProvider, RuntimeType } from "@queuert/postgres";
import type { SQL, TransactionSQL } from "bun";
import { type TxHooks, withTxHooks } from "queuert";

export type BunSqlContext = { txSql: TransactionSQL; txHooks: TxHooks };

export const createBunSqlStateProvider = ({
  sql,
}: {
  sql: SQL;
}): PgStateProvider<BunSqlContext> => {
  // Bun infers each parameter's type from its JS value and has no per-parameter OID override,
  // so dates, JSON, and arrays are sent as text and the explicit casts in the adapter's SQL coerce them.
  type ArrayElement = string | number | boolean | bigint | Date | null | undefined;

  const toText = (value: ArrayElement): string | null => {
    if (value === undefined || value === null) return null;
    if (value instanceof Date) return value.toISOString();
    return String(value);
  };

  // Bun's `sql.array()` encodes `null` elements as the string "null", so build the literal by hand.
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

  const executeBatch = async (
    client: SQL,
    statements: { sql: string; params: unknown[]; paramTypes: Record<number, RuntimeType> }[],
  ): Promise<unknown[][]> => {
    const results = await Promise.allSettled(
      statements.map(async ({ sql: query, params, paramTypes }) => [
        ...(await client.unsafe(
          query,
          params.map((value, index) => serializeParam(value, paramTypes[index])),
        )),
      ]),
    );
    return results.map((result) => {
      if (result.status === "rejected") throw result.reason;
      return result.value;
    });
  };

  return {
    withTransaction: async (cb) =>
      withTxHooks(async (txHooks) =>
        sql.begin("isolation level read committed", async (txSql) => cb({ txSql, txHooks })),
      ),
    isTransaction: (txCtx) => typeof txCtx.txSql.savepoint === "function",
    onTransactionCommit: (txCtx, callback) => {
      txCtx.txHooks.onCommit(callback);
    },
    onTransactionRollback: (txCtx, callback) => {
      txCtx.txHooks.onRollback(callback);
    },
    classifyError: ({ error }) => {
      const driverError = error as { errno?: unknown; message?: unknown } | undefined;
      if (driverError?.errno !== "42P01") return undefined;
      const tableName = /relation "([^"]+)" does not exist/.exec(String(driverError.message))?.[1];
      return tableName === undefined ? undefined : { kind: "undefined_table", tableName };
    },
    executeStatements: async ({ txCtx, statements }) => {
      if (txCtx) return executeBatch(txCtx.txSql, statements);
      using reservedSql = await sql.reserve();
      return await executeBatch(reservedSql, statements);
    },
  };
};
