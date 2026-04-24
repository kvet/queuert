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
    executeSql: async ({ txCtx, sql, params, columnTypes, readOnly }) => {
      const run = (): unknown[] => {
        const database = txCtx?.db ?? db;
        if (Object.keys(columnTypes).length > 0) {
          const stmt = database.prepare(sql);
          return stmt.all(...(params ?? []));
        }
        if (params && params.length > 0) {
          const stmt = database.prepare(sql);
          stmt.run(...params);
        } else {
          database.exec(sql);
        }
        return [] as unknown[];
      };
      if (txCtx) return run();
      using _h = readOnly ? await lock.acquireRead() : await lock.acquireWrite();
      return run();
    },
  };
};

export type BetterSqlite3Provider = SqliteStateProvider<SqliteContext>;
