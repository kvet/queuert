import { type DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";

import { type SqliteStateProvider } from "@queuert/sqlite";

export type NodeSqliteContext = { db: DatabaseSync };

export const createNodeSqliteStateProvider = ({
  db,
}: {
  db: DatabaseSync;
}): SqliteStateProvider<NodeSqliteContext, "sync"> => {
  // The adapter folds template variants (e.g. table prefix) into `id`, so
  // it uniquely identifies the resolved SQL within this provider — keying
  // the prepared-statement cache by `id` is sufficient.
  const stmtCache = new Map<string, StatementSync>();
  const prepare = (id: string | undefined, sql: string): StatementSync => {
    if (id === undefined) return db.prepare(sql);
    let stmt = stmtCache.get(id);
    if (!stmt) {
      stmt = db.prepare(sql);
      stmtCache.set(id, stmt);
    }
    return stmt;
  };

  return {
    withTransaction: (fn) => {
      db.exec("BEGIN");
      try {
        const result = fn({ db });
        db.exec("COMMIT");
        return result;
      } catch (error) {
        if (db.isTransaction) db.exec("ROLLBACK");
        throw error;
      }
    },
    isTransaction: (txCtx) => txCtx.db.isTransaction,
    executeSql: ({ txCtx, id, sql, params, columnTypes }) => {
      // Nothing can interleave with a synchronous transaction, so the provider takes no lock. An
      // autocommit statement that finds a transaction open means a BEGIN was held across an await.
      if (!txCtx && db.isTransaction) {
        throw new Error("An autocommit statement found a transaction open on the connection");
      }
      if (Object.keys(columnTypes).length > 0) {
        return prepare(id, sql).all(...(params as SQLInputValue[]));
      }
      if (params.length > 0) {
        prepare(id, sql).run(...(params as SQLInputValue[]));
      } else {
        db.exec(sql);
      }
      return [];
    },
    close: () => {
      stmtCache.clear();
    },
  };
};
