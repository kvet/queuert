import { type AsyncRwLock, createAsyncRwLock } from "@queuert/helpers/async-rw-lock";
import { type MaybePromise, requireSync } from "@queuert/helpers/maybe-promise";
import { modal } from "@queuert/helpers/modal";
import { step } from "@queuert/helpers/steps";
import type Database from "better-sqlite3";
import { type AdapterMode, type TxHooks, withTxHooks } from "queuert";

import type { SqliteStateProvider, SyncSqliteStateProvider } from "./state-provider.sqlite.ts";

/**
 * Transaction context of {@link createBetterSqlite3Provider}: a better-sqlite3 database and the
 * `txHooks` its commit and rollback callbacks register on. `withTransaction` creates both; a
 * transaction you open yourself passes `txHooks` from `withTxHooks` wrapped around it.
 */
export type BetterSqlite3Context = { db: Database.Database; txHooks: TxHooks };

export type BetterSqlite3Provider = SqliteStateProvider<BetterSqlite3Context>;

export type SyncBetterSqlite3Provider = SyncSqliteStateProvider<BetterSqlite3Context>;

const requireTxHooks = (txCtx: Partial<BetterSqlite3Context>): TxHooks => {
  if (txCtx.txHooks === undefined) {
    throw new Error(
      "The transaction context has no txHooks: open the transaction with the provider's withTransaction, or wrap your transaction in tx hooks and pass them in the context",
    );
  }
  return txCtx.txHooks;
};

type StatementOptions = Parameters<BetterSqlite3Provider["executeSql"]>[0];

/**
 * A SQLite state provider over one better-sqlite3 database. In the `"async"` mode (the default)
 * transactions and statements without `txCtx` take `lock`, so transactions run one at a time; in
 * the `"sync"` mode the provider sets `sync: true` and takes no lock.
 */
export const createBetterSqlite3Provider: {
  (options: { db: Database.Database; lock?: AsyncRwLock; mode?: "async" }): BetterSqlite3Provider;
  (options: { db: Database.Database; mode: "sync" }): SyncBetterSqlite3Provider;
  (options: {
    db: Database.Database;
    lock?: AsyncRwLock;
    mode: AdapterMode;
  }): BetterSqlite3Provider | SyncBetterSqlite3Provider;
} = ({
  db,
  lock: providedLock,
  mode = "async",
}: {
  db: Database.Database;
  lock?: AsyncRwLock;
  mode?: AdapterMode;
}): any => {
  const sync = mode === "sync";
  const lock = sync ? undefined : (providedLock ?? createAsyncRwLock());
  const stmtCache = new Map<string, Database.Statement>();
  const prepareCached = (id: string, sql: string): Database.Statement => {
    let stmt = stmtCache.get(id);
    if (!stmt) {
      stmt = db.prepare(sql);
      stmtCache.set(id, stmt);
    }
    return stmt;
  };

  const runSql = (
    database: Database.Database,
    { id, sql, params, columnTypes }: StatementOptions,
  ): unknown[] => {
    const statement = id !== undefined ? prepareCached(id, sql) : database.prepare(sql);
    if (Object.keys(columnTypes).length > 0) return statement.all(...params);
    statement.run(...params);
    return [];
  };

  const runTransaction = modal(function* (
    fn: (txCtx: BetterSqlite3Context) => MaybePromise<unknown>,
    txHooks: TxHooks,
  ) {
    using _writeLock = lock === undefined ? undefined : yield* step(lock.acquireWrite());
    try {
      db.exec("BEGIN");
      const result = fn({ db, txHooks });
      const value = yield* step(
        sync
          ? requireSync(
              result,
              "The transaction callback returned a promise: it must be synchronous",
            )
          : result,
      );
      db.exec("COMMIT");
      return value;
    } catch (error) {
      if (db.inTransaction) {
        try {
          db.exec("ROLLBACK");
        } catch {}
      }
      throw error;
    }
  });

  const runStatement = modal(function* (options: StatementOptions) {
    if (options.txCtx) return runSql(options.txCtx.db, options);
    using _lock =
      lock === undefined
        ? undefined
        : yield* step(options.readOnly ? lock.acquireRead() : lock.acquireWrite());
    if (db.inTransaction) {
      throw new Error(
        "executeSql without txCtx ran while the connection is inside a transaction: pass that transaction's context",
      );
    }
    return runSql(db, options);
  });

  const provider = {
    withTransaction: (fn: (txCtx: BetterSqlite3Context) => MaybePromise<unknown>) =>
      withTxHooks((txHooks) =>
        sync ? runTransaction.sync(fn, txHooks) : runTransaction.async(fn, txHooks),
      ),
    onTransactionCommit: (
      txCtx: BetterSqlite3Context,
      callback: () => void | Promise<void>,
    ): void => {
      requireTxHooks(txCtx).onCommit(callback);
    },
    onTransactionRollback: (txCtx: BetterSqlite3Context, callback: () => void): void => {
      requireTxHooks(txCtx).onRollback(callback);
    },
    isTransaction: (txCtx: BetterSqlite3Context): boolean => txCtx.db.inTransaction,
    classifyError: ({ error }: { error: unknown }) => {
      const tableName =
        error instanceof Error ? /^no such table: (\S+)/.exec(error.message)?.[1] : undefined;
      return tableName === undefined ? undefined : { kind: "undefined_table" as const, tableName };
    },
    executeSql: (options: StatementOptions) =>
      sync ? runStatement.sync(options) : runStatement.async(options),
    close: (): MaybePromise<void> => {
      stmtCache.clear();
      return sync ? undefined : Promise.resolve();
    },
  };
  return sync ? { sync: true, ...provider } : provider;
};
