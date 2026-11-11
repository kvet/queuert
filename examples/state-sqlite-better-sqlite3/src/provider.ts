import type { AsyncRwLock, SqliteStateProvider } from "@queuert/sqlite";
import type Database from "better-sqlite3";
import { type TxHooks, withTxHooks } from "queuert";

export type BetterSqlite3Context = { db: Database.Database; txHooks: TxHooks };

export const createBetterSqlite3StateProvider = ({
  db,
  lock,
}: {
  db: Database.Database;
  lock: AsyncRwLock;
}): SqliteStateProvider<BetterSqlite3Context> => {
  // The adapter folds template variants (e.g. table prefix) into `id`, so
  // it uniquely identifies the resolved SQL within this provider — keying
  // the prepared-statement cache by `id` is sufficient.
  const stmtCache = new Map<string, Database.Statement>();
  const prepareCached = (id: string, sql: string): Database.Statement => {
    let stmt = stmtCache.get(id);
    if (!stmt) {
      stmt = db.prepare(sql);
      stmtCache.set(id, stmt);
    }
    return stmt;
  };

  const runSql = (
    database: Database.Database,
    {
      id,
      sql,
      params,
      columnTypes,
    }: {
      id: string | undefined;
      sql: string;
      params: unknown[];
      columnTypes: Record<string, unknown>;
    },
  ): unknown[] => {
    const statement = id !== undefined ? prepareCached(id, sql) : database.prepare(sql);
    if (Object.keys(columnTypes).length > 0) return statement.all(...params);
    statement.run(...params);
    return [];
  };

  return {
    withTransaction: async (fn) =>
      withTxHooks(async (txHooks) => {
        using _h = await lock.acquireWrite();
        try {
          db.exec("BEGIN");
          const result = await fn({ db, txHooks });
          db.exec("COMMIT");
          return result;
        } catch (error) {
          if (db.inTransaction) {
            try {
              db.exec("ROLLBACK");
            } catch {
              // ignore rollback errors
            }
          }
          throw error;
        }
      }),
    isTransaction: (txCtx) => txCtx.db.inTransaction,
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
    executeSql: async ({ txCtx, id, sql, params, columnTypes, readOnly }) => {
      if (txCtx) return runSql(txCtx.db, { id, sql, params, columnTypes });
      using _h = readOnly ? await lock.acquireRead() : await lock.acquireWrite();
      return runSql(db, { id, sql, params, columnTypes });
    },
    close: async () => {
      stmtCache.clear();
    },
  };
};
