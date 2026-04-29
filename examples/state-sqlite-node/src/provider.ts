import { type DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";

import { type AsyncRwLock, type SqliteStateProvider } from "@queuert/sqlite";

export type NodeSqliteContext = { db: DatabaseSync };

export const createNodeSqliteStateProvider = ({
  db,
  lock,
}: {
  db: DatabaseSync;
  lock: AsyncRwLock;
}): SqliteStateProvider<NodeSqliteContext> => {
  // Statements are scoped to a Database instance; key by sql to handle
  // template-applied variants (different table prefixes) within one db.
  const stmtCache = new WeakMap<DatabaseSync, Map<string, StatementSync>>();
  const prepareCached = (database: DatabaseSync, sql: string): StatementSync => {
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
      db.exec("BEGIN");
      try {
        const result = await fn({ db });
        db.exec("COMMIT");
        return result;
      } catch (error) {
        if (db.isTransaction) {
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
        const prepare = (): StatementSync =>
          id !== undefined ? prepareCached(database, sql) : database.prepare(sql);
        if (Object.keys(columnTypes).length > 0) {
          return prepare().all(...((params ?? []) as SQLInputValue[]));
        }
        if (params && params.length > 0) {
          prepare().run(...(params as SQLInputValue[]));
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
