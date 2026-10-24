import { type PgStateProvider } from "@queuert/postgres";
import { type RuntimeType } from "@queuert/typed-sql";
import { type SQL, type TransactionSQL } from "bun";

export type BunSqlContext = { txSql: TransactionSQL };

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

  return {
    withTransaction: async (cb) => sql.begin(async (txSql) => cb({ txSql })),
    isTransaction: (txCtx) => typeof txCtx.txSql.savepoint === "function",
    executeSql: async ({ txCtx, sql: query, params, paramTypes }) => {
      const client = txCtx?.txSql ?? sql;
      const serialized = (params ?? []).map((value, i) => serializeParam(value, paramTypes[i]));
      return client.unsafe(query, serialized);
    },
  };
};
