import { type PgStateProvider } from "@queuert/postgres";
import { type RuntimeType } from "@queuert/typed-sql";
import type postgres from "postgres";

export type PostgresJsContext = { sql: postgres.TransactionSql };

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

export const createPostgresJsStateProvider = ({
  sql,
}: {
  sql: postgres.Sql;
}): PgStateProvider<PostgresJsContext> => {
  const typed = sql.typed.bind(sql);
  const pgArray = sql.array.bind(sql);

  const serializeParam = (value: unknown, type: RuntimeType | undefined): unknown => {
    if (value === undefined || value === null) return null;
    if (type === "array") return pgArray(value as any[]);
    if (type === "jsonArray") return pgArray((value as unknown[]).map((el) => JSON.stringify(el)));
    if (type === "json" || type === "json?") return typed(value, JSONB_OID);
    if (typeof value === "string") return typed(value, PG_OID[type!] ?? TEXT_OID);
    return value;
  };

  return {
    withTransaction: async (cb) => sql.begin(async (txSql) => cb({ sql: txSql }) as any),
    withSavepoint: async (txCtx, fn) =>
      txCtx.sql.savepoint(async (spSql) => fn({ sql: spSql })) as any,
    executeSql: async ({ txCtx, sql: query, params, paramTypes }) => {
      const client = txCtx?.sql ?? sql;
      if (!params || params.length === 0) {
        return client.unsafe(query) as any;
      }
      const serialized = params.map((value, i) => serializeParam(value, paramTypes[i]));
      return client.unsafe(query, serialized as any[]) as any;
    },
  };
};
