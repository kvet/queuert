import { type Database, type SQLQueryBindings } from "bun:sqlite";

import { type AsyncRwLock, type SqliteStateProvider } from "@queuert/sqlite";

export type BunSqliteContext = { db: Database };

export const createBunSqliteStateProvider = ({
  db,
  lock,
}: {
  db: Database;
  lock: AsyncRwLock;
}): SqliteStateProvider<BunSqliteContext> => {
  return {
    transactionConcurrency: "serialized",
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
    executeSql: async ({ txCtx, id, sql, params, columnTypes, readOnly }) => {
      const run = (): unknown[] => {
        const database = txCtx?.db ?? db;
        const bindings = (params ?? []) as SQLQueryBindings[];
        const prepare = () =>
          id !== undefined
            ? database.query<unknown, SQLQueryBindings[]>(sql)
            : database.prepare<unknown, SQLQueryBindings[]>(sql);
        if (Object.keys(columnTypes).length > 0) {
          return prepare().all(...bindings);
        }
        if (bindings.length > 0) {
          prepare().run(...bindings);
        } else {
          database.run(sql);
        }
        return [];
      };
      if (txCtx) return run();
      using _h = readOnly ? await lock.acquireRead() : await lock.acquireWrite();
      return run();
    },
  };
};
