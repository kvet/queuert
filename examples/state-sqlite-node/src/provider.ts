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
  // The adapter folds template variants (e.g. table prefix) into `id`, so
  // it uniquely identifies the resolved SQL within this provider — keying
  // the prepared-statement cache by `id` is sufficient.
  const stmtCache = new Map<string, StatementSync>();
  const prepareCached = (id: string, sql: string): StatementSync => {
    let stmt = stmtCache.get(id);
    if (!stmt) {
      stmt = db.prepare(sql);
      stmtCache.set(id, stmt);
    }
    return stmt;
  };

  return {
    transactionConcurrency: "serialized",
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
          id !== undefined ? prepareCached(id, sql) : database.prepare(sql);
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
      stmtCache.clear();
    },
  };
};
