import { type AsyncRwLock, type SqliteStateProvider } from "@queuert/sqlite";
import { type SQL, type TransactionSQL } from "bun";

export type BunSqlSqliteContext = { txSql: TransactionSQL };

export const createBunSqlSqliteStateProvider = ({
  sql,
  lock,
}: {
  sql: SQL;
  lock: AsyncRwLock;
}): SqliteStateProvider<BunSqlSqliteContext> => {
  return {
    // Bun.SQL runs SQLite on a single connection and does not queue transactions on it,
    // so serialize them with the lock.
    withTransaction: async (fn) => {
      using _h = await lock.acquireWrite();
      return await sql.begin(async (txSql) => fn({ txSql }));
    },
    isTransaction: (txCtx) => typeof txCtx.txSql.savepoint === "function",
    withSavepoint: async (txCtx, fn) =>
      // `SavepointSQL` is typed without `savepoint()`, but it supports nesting at runtime.
      txCtx.txSql.savepoint(async (spSql) => fn({ txSql: spSql as TransactionSQL })),
    executeSql: async ({ txCtx, sql: query, params, readOnly }) => {
      if (txCtx) return txCtx.txSql.unsafe(query, params ?? []);
      using _h = readOnly ? await lock.acquireRead() : await lock.acquireWrite();
      return await sql.unsafe(query, params ?? []);
    },
  };
};
