import { type AsyncRwLock, createAsyncRwLock } from "@queuert/helpers/async-rw-lock";
import { type MaybePromise, type Mode, step, syncAsync } from "@queuert/sync-async";
import type Database from "better-sqlite3";
import { type TxHooks, withTxHooks } from "queuert";

import type { SqliteStateProvider } from "./state-provider.sqlite.ts";

export type BetterSqlite3Context = { db: Database.Database; txHooks: TxHooks };

type StatementOptions = Parameters<SqliteStateProvider<BetterSqlite3Context>["executeSql"]>[0];

const requireTxHooks = (txCtx: Partial<BetterSqlite3Context>): TxHooks => {
  if (txCtx.txHooks === undefined) {
    throw new Error(
      "The transaction context has no txHooks: open the transaction with the provider's withTransaction, or wrap your transaction in tx hooks and pass them in the context",
    );
  }
  return txCtx.txHooks;
};

export function createBetterSqlite3Provider(options: {
  db: Database.Database;
  lock?: AsyncRwLock;
  mode?: "async";
}): SqliteStateProvider<BetterSqlite3Context>;
export function createBetterSqlite3Provider(options: {
  db: Database.Database;
  lock?: AsyncRwLock;
  mode: "sync";
}): SqliteStateProvider<BetterSqlite3Context, "sync">;
export function createBetterSqlite3Provider(options: {
  db: Database.Database;
  lock?: AsyncRwLock;
  mode: Mode;
}): SqliteStateProvider<BetterSqlite3Context> | SqliteStateProvider<BetterSqlite3Context, "sync">;
export function createBetterSqlite3Provider({
  db,
  lock = createAsyncRwLock(),
  mode = "async",
}: {
  db: Database.Database;
  lock?: AsyncRwLock;
  mode?: Mode;
}): SqliteStateProvider<BetterSqlite3Context> | SqliteStateProvider<BetterSqlite3Context, "sync"> {
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

  const runOutsideTransaction = (options: StatementOptions): unknown[] => {
    if (db.inTransaction) {
      throw new Error(
        "executeSql without txCtx ran while the connection is inside a transaction: pass that transaction's context",
      );
    }
    return runSql(db, options);
  };

  const runInTransaction = syncAsync(function* (
    txHooks: TxHooks,
    fn: (txCtx: BetterSqlite3Context) => unknown,
  ) {
    try {
      db.exec("BEGIN");
      const value = yield* step(fn({ db, txHooks }));
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

  const members = {
    onTransactionCommit: (txCtx: BetterSqlite3Context, callback: () => MaybePromise<void>) => {
      requireTxHooks(txCtx).onCommit(callback);
    },
    onTransactionRollback: (txCtx: BetterSqlite3Context, callback: () => MaybePromise<void>) => {
      requireTxHooks(txCtx).onRollback(callback);
    },
    isTransaction: (txCtx: BetterSqlite3Context) => txCtx.db.inTransaction,
    classifyError: ({ error }: { error: unknown }) => {
      const tableName =
        error instanceof Error ? /^no such table: (\S+)/.exec(error.message)?.[1] : undefined;
      return tableName === undefined ? undefined : { kind: "undefined_table" as const, tableName };
    },
  };

  return mode === "sync"
    ? ({
        sync: true,
        ...members,
        withTransaction: <T>(fn: (txCtx: BetterSqlite3Context) => T) =>
          withTxHooks((txHooks) => runInTransaction.sync(txHooks, fn) as T),
        executeSql: (options) =>
          options.txCtx ? runSql(options.txCtx.db, options) : runOutsideTransaction(options),
        close: () => {
          stmtCache.clear();
        },
      } satisfies SqliteStateProvider<BetterSqlite3Context, "sync">)
    : ({
        ...members,
        withTransaction: async <T>(fn: (txCtx: BetterSqlite3Context) => Promise<T>) =>
          withTxHooks(async (txHooks) => {
            using _writeLock = await lock.acquireWrite();
            return (await runInTransaction.async(txHooks, fn)) as T;
          }),
        executeSql: async (options) => {
          if (options.txCtx) return runSql(options.txCtx.db, options);
          using _lock = options.readOnly ? await lock.acquireRead() : await lock.acquireWrite();
          return runOutsideTransaction(options);
        },
        close: async () => {
          stmtCache.clear();
        },
      } satisfies SqliteStateProvider<BetterSqlite3Context>);
}
