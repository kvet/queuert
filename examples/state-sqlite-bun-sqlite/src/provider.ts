import type { Database, SQLQueryBindings } from "bun:sqlite";

import type { SyncSqliteStateProvider } from "@queuert/sqlite";
import { type TxHooks, withTxHooks } from "queuert";

export type BunSqliteContext = { db: Database; txHooks: TxHooks };

const requireTxHooks = (txCtx: Partial<BunSqliteContext>): TxHooks => {
  if (txCtx.txHooks === undefined) {
    throw new Error(
      "The transaction context has no txHooks: open the transaction with withTransaction, or create txHooks with withTxHooks and pass them in the context",
    );
  }
  return txCtx.txHooks;
};

export const createBunSqliteStateProvider = ({
  db,
}: {
  db: Database;
}): SyncSqliteStateProvider<BunSqliteContext> => {
  return {
    sync: true,
    withTransaction: (fn) =>
      withTxHooks((txHooks) =>
        db.transaction(() => {
          const result = fn({ db, txHooks });
          if (result instanceof Promise) {
            throw new TypeError("withTransaction callback must not return a promise");
          }
          return result;
        })(),
      ),
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
    executeSql: ({ txCtx, id, sql, params }) => {
      if (!txCtx && db.inTransaction) {
        throw new Error("executeSql without txCtx ran inside an open transaction");
      }
      const statement =
        id !== undefined
          ? db.query<unknown, SQLQueryBindings[]>(sql)
          : db.prepare<unknown, SQLQueryBindings[]>(sql);
      return statement.all(...(params as SQLQueryBindings[]));
    },
  };
};
