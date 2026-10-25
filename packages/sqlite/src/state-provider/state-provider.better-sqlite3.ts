import { type AsyncRwLock, createAsyncRwLock } from "@queuert/helpers";
import type Database from "better-sqlite3";

import { type SqliteStateProvider } from "./state-provider.sqlite.js";

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
    executeSql: async ({ txCtx, id, sql, params, columnTypes, readOnly }) => {
      const database = txCtx?.db ?? db;
      const run = (): unknown[] => {
        const prepare = (): Database.Statement =>
          id !== undefined ? prepareCached(id, sql) : database.prepare(sql);
        if (Object.keys(columnTypes).length > 0) {
          return prepare().all(...(params ?? []));
        }
        if (params && params.length > 0) {
          prepare().run(...params);
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

export type BetterSqlite3Provider = SqliteStateProvider<BetterSqlite3Context>;

export const createBetterSqlite3SyncProvider = ({
  db,
}: {
  db: Database.Database;
}): SqliteStateProvider<BetterSqlite3Context, "sync"> => {
  const stmtCache = new Map<string, Database.Statement>();
  const prepare = (id: string | undefined, sql: string): Database.Statement => {
    if (id === undefined) return db.prepare(sql);
    let stmt = stmtCache.get(id);
    if (!stmt) {
      stmt = db.prepare(sql);
      stmtCache.set(id, stmt);
    }
    return stmt;
  };

  return {
    withTransaction: (fn) => db.transaction(() => fn({ db }))(),
    isTransaction: (txCtx) => txCtx.db.inTransaction,
    executeSql: ({ txCtx, id, sql, params, columnTypes }) => {
      if (!txCtx && db.inTransaction) {
        throw new Error(
          "An autocommit statement found a transaction open on the connection: in sync mode a transaction must not stay open across an await",
        );
      }
      if (Object.keys(columnTypes).length > 0) return prepare(id, sql).all(...params);
      if (params.length > 0) {
        prepare(id, sql).run(...params);
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
