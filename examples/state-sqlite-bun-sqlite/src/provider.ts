import type { Database, SQLQueryBindings } from "bun:sqlite";

import type { AsyncRwLock, SqliteStateProvider } from "@queuert/sqlite";

export type BunSqliteContext = { db: Database };

export const createBunSqliteStateProvider = ({
  db,
  lock,
}: {
  db: Database;
  lock: AsyncRwLock;
}): SqliteStateProvider<BunSqliteContext> => {
  return {
    withTransaction: async (fn) => {
      using _h = await lock.acquireWrite();
      db.run("BEGIN");
      try {
        const result = await fn({ db });
        db.run("COMMIT");
        return result;
      } catch (error) {
        if (db.inTransaction) {
          try {
            db.run("ROLLBACK");
          } catch {
            // ignore rollback errors
          }
        }
        throw error;
      }
    },
    isTransaction: (txCtx) => txCtx.db.inTransaction,
    executeSql: async ({ txCtx, id, sql, params, readOnly }) => {
      const run = (): unknown[] => {
        const database = txCtx?.db ?? db;
        const statement =
          id !== undefined
            ? database.query<unknown, SQLQueryBindings[]>(sql)
            : database.prepare<unknown, SQLQueryBindings[]>(sql);
        return statement.all(...(params as SQLQueryBindings[]));
      };
      if (txCtx) return run();
      using _h = readOnly ? await lock.acquireRead() : await lock.acquireWrite();
      return run();
    },
  };
};
