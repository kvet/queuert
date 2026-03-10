import { type SqliteStateProvider, createAsyncLock } from "@queuert/sqlite";
import type BetterSqlite3 from "better-sqlite3";

type DbContext = { db: BetterSqlite3.Database };

export const createSqliteStateProvider = (
  db: BetterSqlite3.Database,
): SqliteStateProvider<DbContext> => {
  const lock = createAsyncLock();

  return {
    runInTransaction: async (fn) => {
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
    executeSql: async ({ txCtx, sql, params, returns }) => {
      const database = txCtx?.db ?? db;
      if (returns) {
        const stmt = database.prepare(sql);
        return stmt.all(...(params ?? [])) as Record<string, unknown>[];
      } else {
        if (params && params.length > 0) {
          const stmt = database.prepare(sql);
          stmt.run(...params);
        } else {
          database.exec(sql);
        }
        return [];
      }
    },
  };
};
