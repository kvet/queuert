import type Database from "better-sqlite3";
import { createAsyncRwLock } from "queuert/internal";

import { type SqliteStateProvider } from "./state-provider.sqlite.js";

export type SqliteContext = { db: Database.Database };

export const createBetterSqlite3Provider = ({
  db,
}: {
  db: Database.Database;
}): SqliteStateProvider<SqliteContext> => {
  const lock = createAsyncRwLock();
  const stmtCache = new WeakMap<Database.Database, Map<string, Database.Statement>>();
  const prepareCached = (database: Database.Database, sql: string): Database.Statement => {
    let perDb = stmtCache.get(database);
    if (!perDb) {
      perDb = new Map();
      stmtCache.set(database, perDb);
    }
    let stmt = perDb.get(sql);
    if (!stmt) {
      stmt = database.prepare(sql);
      perDb.set(sql, stmt);
    }
    return stmt;
  };

  return {
    withTransaction: async (fn) => {
      using _h = await lock.acquireWrite();
      try {
        db.exec("BEGIN IMMEDIATE");
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
    executeSql: async ({ txCtx, id, sql, params, columnTypes, readOnly }) => {
      const run = (): unknown[] => {
        const database = txCtx?.db ?? db;
        const prepare = (): Database.Statement =>
          id !== undefined ? prepareCached(database, sql) : database.prepare(sql);
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
      stmtCache.delete(db);
    },
  };
};

export type BetterSqlite3Provider = SqliteStateProvider<SqliteContext>;
