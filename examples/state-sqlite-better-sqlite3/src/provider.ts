import { type AsyncLock, type SqliteStateProvider } from "@queuert/sqlite";
import type Database from "better-sqlite3";

export type BetterSqlite3Context = { db: Database.Database };

export const createBetterSqlite3StateProvider = ({
  db,
  lock,
}: {
  db: Database.Database;
  lock: AsyncLock;
}): SqliteStateProvider<BetterSqlite3Context> => {
  return {
    withTransaction: async (fn) => {
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
    executeSql: async ({ txCtx, sql, params, columnTypes }) => {
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
    },
  };
};
