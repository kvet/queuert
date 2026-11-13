import type { DatabaseSync, SQLInputValue, StatementSync } from "node:sqlite";

import type { SyncSqliteStateProvider } from "@queuert/sqlite";
import { type TxHooks, withTxHooks } from "queuert";

export type NodeSqliteContext = { db: DatabaseSync; txHooks: TxHooks };

const requireTxHooks = (txCtx: Partial<NodeSqliteContext>): TxHooks => {
  if (txCtx.txHooks === undefined) {
    throw new Error(
      "The transaction context has no txHooks: open the transaction with withTransaction, or create txHooks with withTxHooks and pass them in the context",
    );
  }
  return txCtx.txHooks;
};

export const createNodeSqliteStateProvider = ({
  db,
}: {
  db: DatabaseSync;
}): SyncSqliteStateProvider<NodeSqliteContext> => {
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
    sync: true,
    withTransaction: (fn) =>
      withTxHooks((txHooks) => {
        db.exec("BEGIN");
        try {
          const result = fn({ db, txHooks });
          if (result instanceof Promise) {
            throw new TypeError("withTransaction callback must not return a promise");
          }
          db.exec("COMMIT");
          return result;
        } catch (error) {
          if (db.isTransaction) db.exec("ROLLBACK");
          throw error;
        }
      }),
    isTransaction: (txCtx) => txCtx.db.isTransaction,
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
    executeSql: ({ txCtx, id, sql, params }) => {
      if (!txCtx && db.isTransaction) {
        throw new Error("executeSql without txCtx ran inside an open transaction");
      }
      const statement = id !== undefined ? prepareCached(id, sql) : db.prepare(sql);
      return statement.all(...(params as SQLInputValue[]));
    },
    close: () => {
      stmtCache.clear();
    },
  };
};
