import { type DatabaseSync, type SQLInputValue } from "node:sqlite";

import { type AsyncRwLock, type SqliteStateProvider } from "@queuert/sqlite";

export type NodeSqliteContext = { db: DatabaseSync };

export const createNodeSqliteStateProvider = ({
  db,
  lock,
}: {
  db: DatabaseSync;
  lock: AsyncRwLock;
}): SqliteStateProvider<NodeSqliteContext> => {
  return {
    withTransaction: async (fn) => {
      using _h = await lock.acquireWrite();
      db.exec("BEGIN IMMEDIATE");
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
    executeSql: async ({ txCtx, sql, params, columnTypes, readOnly }) => {
      const run = (): unknown[] => {
        const database = txCtx?.db ?? db;
        if (Object.keys(columnTypes).length > 0) {
          const stmt = database.prepare(sql);
          return stmt.all(...((params ?? []) as SQLInputValue[]));
        }
        if (params && params.length > 0) {
          const stmt = database.prepare(sql);
          stmt.run(...(params as SQLInputValue[]));
        } else {
          database.exec(sql);
        }
        return [] as unknown[];
      };
      if (txCtx) return run();
      using _h = readOnly ? await lock.acquireRead() : await lock.acquireWrite();
      return run();
    },
  };
};
