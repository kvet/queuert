import { type SqliteStateProvider, createAsyncLock } from "@queuert/sqlite";
import Database from "better-sqlite3";
import { join } from "node:path";

const DB_PATH = join(import.meta.dirname, "..", "data.db");

type DbContext = { db: Database.Database };

export const createDatabase = (): Database.Database => {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
};

export const createStateProvider = (db: Database.Database): SqliteStateProvider<DbContext> => {
  const lock = createAsyncLock();

  return {
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
          return [];
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
  };
};
