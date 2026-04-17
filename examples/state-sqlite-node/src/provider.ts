import { type DatabaseSync, type SQLInputValue } from "node:sqlite";

import { type AsyncLock, type SqliteStateProvider } from "@queuert/sqlite";

export type NodeSqliteContext = { db: DatabaseSync };

export const createNodeSqliteStateProvider = ({
  db,
  lock,
}: {
  db: DatabaseSync;
  lock: AsyncLock;
}): SqliteStateProvider<NodeSqliteContext> => {
  return {
    withTransaction: async (fn) => {
      await lock.acquire();
      try {
        db.exec("BEGIN IMMEDIATE");
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
      } finally {
        lock.release();
      }
    },
    executeSql: async ({ txCtx, sql, params, columnTypes }) => {
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
    },
  };
};
