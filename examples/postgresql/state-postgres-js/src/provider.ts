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
  /**
   * When true (default), queries that arrive with an `id` are sent with
   * `{ prepare: true }` so postgres.js caches the parsed plan per connection.
   * Set to `false` for transaction-mode connection poolers (PgBouncer < 1.21,
   * Supavisor without per-client tracking) where server-side prepared statements
   * break across pooled sessions.
   */
  prepareStatements?: boolean;
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

  const executeBatch = async (
    client: postgres.TransactionSql | postgres.ReservedSql,
    statements: {
      id?: string;
      sql: string;
      params: unknown[];
      paramTypes: Record<number, RuntimeType>;
    }[],
  ): Promise<unknown[][]> => {
    const results = await Promise.allSettled(
      statements.map(({ id, sql: query, params, paramTypes }) =>
        client.unsafe(
          query,
          params.map((value, index) => serializeParam(value, paramTypes[index])) as any[],
          { prepare: prepareStatements && id !== undefined },
        ),
      ),
    );
    return results.map((result) => {
      if (result.status === "rejected") throw result.reason;
      return [...result.value];
    });
  };

  return {
    withTransaction: async (cb) =>
      withTxHooks(async (txHooks) =>
        sql.begin("isolation level read committed", async (txSql) => cb({ txSql, txHooks }) as any),
      ),
    isTransaction: (txCtx) => typeof txCtx.txSql.savepoint === "function",
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
    executeStatements: async ({ txCtx, statements }) => {
      if (txCtx) return executeBatch(txCtx.txSql, statements);
      const reservedSql = await sql.reserve();
      try {
        return await executeBatch(reservedSql, statements);
      } finally {
        reservedSql.release();
      }
    },
  };
};
