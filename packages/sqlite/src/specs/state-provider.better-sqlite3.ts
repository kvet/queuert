import type Database from "better-sqlite3";
import { createAsyncLock } from "queuert/internal";
import { type SqliteStateProvider } from "../state-provider/state-provider.sqlite.js";

export type SqliteContext = { db: Database.Database };

export const createBetterSqlite3Provider = ({
  db,
}: {
  db: Database.Database;
}): SqliteStateProvider<SqliteContext> => {
  const lock = createAsyncLock();

  return {
    executeSql: async ({ txContext, sql, params, returns }) => {
      const executeRaw = ({
        database,
        sql,
        params,
        returns,
      }: {
        database: Database.Database;
        sql: string;
        params?: unknown[];
        returns: boolean;
      }) => {
        if (returns) {
          const stmt = database.prepare(sql);
          return stmt.all(...(params ?? []));
        } else {
          if (params && params.length > 0) {
            const stmt = database.prepare(sql);
            stmt.run(...params);
          } else {
            database.exec(sql);
          }
          return [] as unknown[];
        }
      };

      if (txContext) {
        return executeRaw({ database: txContext.db, sql, params, returns });
      }

      await lock.acquire();
      try {
        return executeRaw({ database: db, sql, params, returns });
      } finally {
        lock.release();
      }
    },
    runInTransaction: async (fn) => {
      await lock.acquire();
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
      } finally {
        lock.release();
      }
    },
  };
};

export type BetterSqlite3Provider = SqliteStateProvider<SqliteContext>;
