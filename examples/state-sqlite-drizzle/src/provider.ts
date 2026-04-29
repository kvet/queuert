import { type AsyncRwLock, type SqliteStateProvider } from "@queuert/sqlite";
import type Database from "better-sqlite3";

export type DrizzleSqliteContext = { db: Database.Database };

export const createDrizzleSqliteStateProvider = ({
  db,
  lock,
}: {
  db: Database.Database;
  lock: AsyncRwLock;
}): SqliteStateProvider<DrizzleSqliteContext> => {
  // Statements are scoped to a Database instance; key by sql to handle
  // template-applied variants (different table prefixes) within one db.
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
        return [];
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
