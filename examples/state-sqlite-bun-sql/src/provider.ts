import type { AsyncRwLock, SqliteStateProvider } from "@queuert/sqlite";
import type { SQL, TransactionSQL } from "bun";
import { type TxHooks, withTxHooks } from "queuert";

export type BunSqlSqliteContext = { txSql: TransactionSQL; txHooks: TxHooks };

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
    withTransaction: async (fn) =>
      withTxHooks(async (txHooks) => {
        using _h = await lock.acquireWrite();
        return await sql.begin(async (txSql) => fn({ txSql, txHooks }));
      }),
    isTransaction: (txCtx) => typeof txCtx.txSql.savepoint === "function",
    onTransactionCommit: (txCtx, callback) => {
      txCtx.txHooks.onCommit(callback);
    },
    onTransactionRollback: (txCtx, callback) => {
      txCtx.txHooks.onRollback(callback);
    },
    classifyError: ({ error }) => {
      const tableName = /no such table: (\S+)/.exec(
        String((error as { message?: unknown } | undefined)?.message),
      )?.[1];
      return tableName === undefined ? undefined : { kind: "undefined_table", tableName };
    },
    executeSql: async ({ txCtx, sql: query, params, readOnly }) => {
      if (txCtx) return txCtx.txSql.unsafe(query, params ?? []);
      using _h = readOnly ? await lock.acquireRead() : await lock.acquireWrite();
      return await sql.unsafe(query, params ?? []);
    },
  };
};
