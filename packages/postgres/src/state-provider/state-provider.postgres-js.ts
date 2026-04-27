import { type RuntimeType } from "@queuert/typed-sql";
import type postgres from "postgres";

import { type PgStateProvider } from "./state-provider.pg.js";

export type PostgresJsContext = { sql: postgres.TransactionSql };
export type PostgresJsProvider = PgStateProvider<PostgresJsContext>;

const TEXT_OID = 25;
const UUID_OID = 2950;
const JSONB_OID = 3802;

const PG_OID: Partial<Record<RuntimeType, number>> = {
  uuid: UUID_OID,
  "uuid?": UUID_OID,
  string: TEXT_OID,
  "string?": TEXT_OID,
  json: JSONB_OID,
  "json?": JSONB_OID,
};

export const createPostgresJsProvider = ({ sql }: { sql: postgres.Sql }): PostgresJsProvider => {
  const typed = sql.typed.bind(sql);
  const pgArray = sql.array.bind(sql);

  const serializeParam = (value: unknown, type: RuntimeType | undefined): unknown => {
    if (value === undefined || value === null) return null;
    if (type === "array") return pgArray(value as any[]);
    if (type === "jsonArray") return pgArray((value as unknown[]).map((el) => JSON.stringify(el)));
    if (type === "json" || type === "json?") return typed(value, JSONB_OID);
    // Force explicit OIDs for string params to prevent postgres.js
    // from auto-detecting timestamps and truncating microsecond precision.
    if (typeof value === "string") return typed(value, PG_OID[type!] ?? TEXT_OID);
    return value;
  };

  return {
    withTransaction: async (fn) => {
      return sql.begin(async (txSql) => fn({ sql: txSql }) as any);
    },
    withSavepoint: async (txCtx, fn) => {
      return txCtx.sql.savepoint(async (savepointSql) => fn({ sql: savepointSql }) as any);
    },
    executeSql: async ({ txCtx, id, sql: query, params, paramTypes }) => {
      const sqlClient = txCtx?.sql ?? sql;
      const prepare = id !== undefined;
      if (!params || params.length === 0) {
        return sqlClient.unsafe(query, [], { prepare }) as any;
      }
      const serializedParams = params.map((value, index) =>
        serializeParam(value, paramTypes[index]),
      );
      return sqlClient.unsafe(query, serializedParams as any[], { prepare }) as any;
    },
  };
};
