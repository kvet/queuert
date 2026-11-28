import type { PgStateProvider, RuntimeType } from "@queuert/postgres";
import type postgres from "postgres";
import { type TxHooks, withTxHooks } from "queuert";

export type PostgresJsContext = { txSql: postgres.TransactionSql; txHooks: TxHooks };

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
  prepareStatements = true,
}: {
  sql: postgres.Sql;
  prepareStatements?: boolean;
}): PgStateProvider<PostgresJsContext> => {
  const typed = sql.typed.bind(sql);

  const serializeParam = (value: unknown, type: RuntimeType | undefined): unknown => {
    if (value === undefined || value === null) return null;
    if (type === "array") return value;
    if (type === "jsonArray") return (value as unknown[]).map((el) => JSON.stringify(el));
    if (type === "json" || type === "json?") return typed(value, JSONB_OID);
    if (typeof value === "string") return typed(value, PG_OID[type!] ?? TEXT_OID);
    return value;
  };

  return {
    withTransaction: async (cb) =>
      withTxHooks(async (txHooks) => sql.begin(async (txSql) => cb({ txSql, txHooks }) as any)),
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
      const driverError = error as { code?: unknown; message?: unknown } | undefined;
      if (driverError?.code === "40001" || driverError?.code === "40P01")
        return { kind: "transaction_conflict" };
      if (driverError?.code === "55P03") return { kind: "lock_not_available" };
      if (driverError?.code !== "42P01") return undefined;
      const tableName = /relation "([^"]+)" does not exist/.exec(String(driverError.message))?.[1];
      return tableName === undefined ? undefined : { kind: "undefined_table", tableName };
    },
    executeSql: async ({ txCtx, id, sql: query, params, paramTypes }) => {
      const client = txCtx?.txSql ?? sql;
      const prepare = prepareStatements && id !== undefined;
      if (!params || params.length === 0) {
        return client.unsafe(query, [], { prepare }) as any;
      }
      const serialized = params.map((value, i) => serializeParam(value, paramTypes[i]));
      return client.unsafe(query, serialized as any[], { prepare }) as any;
    },
  };
};
