import { type AsyncRwLock, type SqliteStateProvider } from "@queuert/sqlite";
import type Database from "better-sqlite3";

export type BetterSqlite3Context = { db: Database.Database };

export const createBetterSqlite3StateProvider = ({
  db,
  lock,
}: {
  db: Database.Database;
  lock: AsyncRwLock;
}): SqliteStateProvider<BetterSqlite3Context> => {
  // The adapter folds template variants (e.g. table prefix) into `id`, so
  // it uniquely identifies the resolved SQL within this provider — keying
  // the prepared-statement cache by `id` is sufficient.
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
    executeSql: async ({ txCtx, id, sql, params, columnTypes, readOnly }) => {
      const run = (): unknown[] => {
        const database = txCtx?.db ?? db;
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
