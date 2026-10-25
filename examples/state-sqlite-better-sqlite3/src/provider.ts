import { type SqliteStateProvider } from "@queuert/sqlite";
import type Database from "better-sqlite3";

export type BetterSqlite3Context = { db: Database.Database };

export const createBetterSqlite3StateProvider = ({
  db,
}: {
  db: Database.Database;
}): SqliteStateProvider<BetterSqlite3Context, "sync"> => {
  // The adapter folds template variants (e.g. table prefix) into `id`, so
  // it uniquely identifies the resolved SQL within this provider — keying
  // the prepared-statement cache by `id` is sufficient.
  const stmtCache = new Map<string, Database.Statement>();
  const prepare = (id: string | undefined, sql: string): Database.Statement => {
    if (id === undefined) return db.prepare(sql);
    let stmt = stmtCache.get(id);
    if (!stmt) {
      stmt = db.prepare(sql);
      stmtCache.set(id, stmt);
    }
    return stmt;
  };

  return {
    withTransaction: (fn) => db.transaction(() => fn({ db }))(),
    isTransaction: (txCtx) => txCtx.db.inTransaction,
    executeSql: ({ txCtx, id, sql, params, columnTypes }) => {
      // Nothing can interleave with a synchronous transaction, so the provider takes no lock. An
      // autocommit statement that finds a transaction open means a BEGIN was held across an await.
      if (!txCtx && db.inTransaction) {
        throw new Error("An autocommit statement found a transaction open on the connection");
      }
      if (Object.keys(columnTypes).length > 0) return prepare(id, sql).all(...params);
      if (params.length > 0) {
        prepare(id, sql).run(...params);
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
