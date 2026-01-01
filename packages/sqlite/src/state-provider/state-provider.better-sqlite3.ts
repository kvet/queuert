import type Database from "better-sqlite3";
import { SqliteStateProvider } from "./state-provider.sqlite.js";

export type SqliteContext = { db: Database.Database };

export const createBetterSqlite3Provider = ({
  db,
}: {
  db: Database.Database;
}): SqliteStateProvider<SqliteContext> => {
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
    assertInTransaction: async ({ db }) => {
      if (!db.inTransaction) {
        throw new Error("Expected to be in a transaction");
      }
    },
    runInTransaction: async ({ db }, fn) => {
      if (db.inTransaction) {
        return fn({ db });
      }

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
    },
  };
};

export type BetterSqlite3Provider = SqliteStateProvider<SqliteContext>;
