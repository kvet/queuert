import type Database from "better-sqlite3";
import { createAsyncLock } from "queuert/internal";
import { SqliteStateProvider } from "../state-provider/state-provider.sqlite.js";

export type SqliteContext = { db: Database.Database };

export const createBetterSqlite3Provider = ({
  db,
}: {
  db: Database.Database;
}): SqliteStateProvider<SqliteContext> => {
  const lock = createAsyncLock();

  return {
    provideContext: async (fn) => {
      return fn({ db });
    },
    executeSql: async ({ db }, sql, params, returns) => {
      const stmt = db.prepare(sql);
      if (returns) {
        return stmt.all(...(params ?? [])) as any;
      } else {
        stmt.run(...(params ?? []));
        return [] as any;
      }
    },
    isInTransaction: async ({ db }) => {
      return db.inTransaction;
    },
    runInTransaction: async ({ db }, fn) => {
      await lock.acquire();
      try {
        db.exec("BEGIN IMMEDIATE");
        try {
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
      } finally {
        lock.release();
      }
    },
  };
};

export type BetterSqlite3Provider = SqliteStateProvider<SqliteContext>;
