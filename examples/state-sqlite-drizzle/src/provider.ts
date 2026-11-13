import type { SyncSqliteStateProvider } from "@queuert/sqlite";
import type Database from "better-sqlite3";
import { type TxHooks, withTxHooks } from "queuert";

export type DrizzleSqliteContext = { db: Database.Database; txHooks: TxHooks };

const requireTxHooks = (txCtx: Partial<DrizzleSqliteContext>): TxHooks => {
  if (txCtx.txHooks === undefined) {
    throw new Error(
      "The transaction context has no txHooks: open the transaction with withTransaction, or create txHooks with withTxHooks and pass them in the context",
    );
  }
  return txCtx.txHooks;
};

export const createDrizzleSqliteStateProvider = ({
  db,
}: {
  db: Database.Database;
}): SyncSqliteStateProvider<DrizzleSqliteContext> => {
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
    sync: true,
    withTransaction: (fn) => withTxHooks((txHooks) => db.transaction(() => fn({ db, txHooks }))()),
    isTransaction: (txCtx) => txCtx.db.inTransaction,
    onTransactionCommit: (txCtx, callback) => {
      requireTxHooks(txCtx).onCommit(callback);
    },
    onTransactionRollback: (txCtx, callback) => {
      requireTxHooks(txCtx).onRollback(callback);
    },
    classifyError: ({ error }) => {
      const tableName = /no such table: (\S+)/.exec(
        String((error as { message?: unknown } | undefined)?.message),
      )?.[1];
      return tableName === undefined ? undefined : { kind: "undefined_table", tableName };
    },
    executeSql: ({ txCtx, id, sql, params, columnTypes }) => {
      if (!txCtx && db.inTransaction) {
        throw new Error("executeSql without txCtx ran inside an open transaction");
      }
      const statement = id !== undefined ? prepareCached(id, sql) : db.prepare(sql);
      if (Object.keys(columnTypes).length > 0) return statement.all(...params);
      statement.run(...params);
      return [];
    },
    close: () => {
      stmtCache.clear();
    },
  };
};
