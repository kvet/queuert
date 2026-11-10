import { type AsyncRwLock, createAsyncRwLock } from "@queuert/helpers";
import type Database from "better-sqlite3";

import type { SqliteStateProvider } from "./state-provider.sqlite.ts";

export type BetterSqlite3Context = { db: Database.Database };

export const createBetterSqlite3Provider = ({
  db,
  lock = createAsyncRwLock(),
}: {
  db: Database.Database;
  lock?: AsyncRwLock;
}): SqliteStateProvider<BetterSqlite3Context> => {
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
    withTransaction: async (fn) => {
      using _h = await lock.acquireWrite();
      try {
        db.exec("BEGIN");
        const result = await fn({ db });
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
    },
    isTransaction: (txCtx) => txCtx.db.inTransaction,
    classifyError: ({ error }) => {
      const tableName =
        error instanceof Error ? /^no such table: (\S+)/.exec(error.message)?.[1] : undefined;
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

export type BetterSqlite3Provider = SqliteStateProvider<BetterSqlite3Context>;
