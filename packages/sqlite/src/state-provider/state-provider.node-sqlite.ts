import { type DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";

import { type AsyncRwLock, createAsyncRwLock } from "@queuert/helpers";

import { type SqliteStateProvider } from "./state-provider.sqlite.js";

export type NodeSqliteContext = { db: DatabaseSync };

export const createNodeSqliteProvider = ({
  db,
  lock = createAsyncRwLock(),
}: {
  db: DatabaseSync;
  lock?: AsyncRwLock;
}): SqliteStateProvider<NodeSqliteContext> => {
  const stmtCache = new Map<string, StatementSync>();
  const prepareCached = (id: string, sql: string): StatementSync => {
    let stmt = stmtCache.get(id);
    if (!stmt) {
      stmt = db.prepare(sql);
      stmtCache.set(id, stmt);
    }
    return stmt;
  };

  return {
    withTransaction: async (fn) => {
      using _h = await lock.acquireWrite();
      db.exec("BEGIN");
      try {
        const result = await fn({ db });
        db.exec("COMMIT");
        return result;
      } catch (error) {
        if (db.isTransaction) {
          try {
            db.exec("ROLLBACK");
          } catch {
            // ignore rollback errors
          }
        }
        throw error;
      }
    },
    isTransaction: (txCtx) => txCtx.db.isTransaction,
    executeSql: async ({ txCtx, id, sql, params, columnTypes, readOnly }) => {
      const run = (): unknown[] => {
        const database = txCtx?.db ?? db;
        const prepare = (): StatementSync =>
          id !== undefined ? prepareCached(id, sql) : database.prepare(sql);
        if (Object.keys(columnTypes).length > 0) {
          return prepare().all(...((params ?? []) as SQLInputValue[]));
        }
        if (params && params.length > 0) {
          prepare().run(...(params as SQLInputValue[]));
        } else {
          database.exec(sql);
        }
        return [] as unknown[];
      };
      if (txCtx) return run();
      using _h = readOnly ? await lock.acquireRead() : await lock.acquireWrite();
      return run();
    },
    close: async () => {
      stmtCache.clear();
    },
  };
};

export type NodeSqliteProvider = SqliteStateProvider<NodeSqliteContext>;

export const createNodeSqliteSyncProvider = ({
  db,
}: {
  db: DatabaseSync;
}): SqliteStateProvider<NodeSqliteContext, "sync"> => {
  const stmtCache = new Map<string, StatementSync>();
  const prepare = (id: string | undefined, sql: string): StatementSync => {
    if (id === undefined) return db.prepare(sql);
    let stmt = stmtCache.get(id);
    if (!stmt) {
      stmt = db.prepare(sql);
      stmtCache.set(id, stmt);
    }
    return stmt;
  };

  return {
    withTransaction: (fn) => {
      db.exec("BEGIN");
      try {
        const result = fn({ db });
        db.exec("COMMIT");
        return result;
      } catch (error) {
        if (db.isTransaction) db.exec("ROLLBACK");
        throw error;
      }
    },
    isTransaction: (txCtx) => txCtx.db.isTransaction,
    executeSql: ({ txCtx, id, sql, params, columnTypes }) => {
      if (!txCtx && db.isTransaction) {
        throw new Error(
          "An autocommit statement found a transaction open on the connection: in sync mode a transaction must not stay open across an await",
        );
      }
      if (Object.keys(columnTypes).length > 0) {
        return prepare(id, sql).all(...(params as SQLInputValue[]));
      }
      if (params.length > 0) {
        prepare(id, sql).run(...(params as SQLInputValue[]));
      } else {
        db.exec(sql);
      }
      return [];
    },
    close: () => {
      stmtCache.clear();
    },
  };
};
