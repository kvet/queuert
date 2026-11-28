import type { RuntimeType } from "@queuert/typed-sql";
import type { BaseTxContext } from "queuert";

/**
 * The classification of a driver error the MySQL state adapter acts on, as returned by
 * {@link MysqlStateProvider.classifyError}.
 *
 * - `undefined_table` — error 1146 (`ER_NO_SUCH_TABLE`), with the missing table's qualified name as
 *   the server reports it (`Table '<database>.<table>' doesn't exist`).
 * - `transaction_conflict` — error 1213 (`ER_LOCK_DEADLOCK`), raised at any level, or 1020
 *   (`ER_CHECKREAD`), raised by MariaDB's `innodb_snapshot_isolation` at REPEATABLE READ and
 *   SERIALIZABLE; the server rolls the whole transaction back for both. The adapter retries it in
 *   the transactions and statements it runs without a caller's transaction; a provider that does
 *   not report it leaves it unretried.
 *
 * @experimental
 */
export type MysqlErrorClassification =
  | { kind: "undefined_table"; tableName: string }
  | { kind: "transaction_conflict" };

/**
 * MySQL and MariaDB state provider interface.
 *
 * Abstracts database client operations, providing context management, transaction handling,
 * and SQL execution. Users create their own implementation to integrate with their preferred
 * client (`mysql2`, `mariadb`, Drizzle, Kysely, etc.).
 *
 * Every connection must have a default database selected, even when the adapter's `schema` names
 * another one: MySQL rejects multi-table updates over `JSON_TABLE` on a connection without one.
 *
 * Transactions passed to Queuert may run at READ COMMITTED, REPEATABLE READ or SERIALIZABLE, as a
 * session default or per transaction, including mixed levels; REPEATABLE READ and SERIALIZABLE
 * are experimental. Transactions the provider opens itself run at READ COMMITTED.
 *
 * @typeParam TTxContext - The transaction context type containing database client/connection info
 *
 * @experimental
 */
export type MysqlStateProvider<TTxContext extends BaseTxContext> = {
  /**
   * Executes a callback within a database transaction at READ COMMITTED: issues
   * `SET TRANSACTION ISOLATION LEVEL READ COMMITTED` and then `START TRANSACTION` on the same
   * connection with nothing between them, commits on success, rolls back on error, and releases
   * the connection. Queuert's own transactions stay at READ COMMITTED whatever the session default,
   * since locking scans at REPEATABLE READ take gap locks that block inserts of new jobs. The
   * adapter may call it again after a `transaction_conflict` error, so it must open a fresh
   * transaction on every call.
   */
  withTransaction: <T>(fn: (txCtx: TTxContext) => Promise<T>) => Promise<T>;

  /**
   * The object that identifies the open transaction `txCtx` belongs to, or `undefined` when `txCtx`
   * is not inside an open transaction. Must be synchronous and must not query the database: derive
   * the answer from transaction state the driver or the context already tracks. Every context inside
   * one transaction gives the same object, its savepoints and `retryBoundary` tries included, and
   * every other transaction a different one; a provider that carries `TxHooks` in its transaction
   * context returns them. It is `undefined` once the transaction has ended, in the transaction's own
   * commit and rollback callbacks too, so a driver flag that stays set on a finished transaction is
   * not enough; a savepoint or `retryBoundary` rollback leaves it open.
   */
  getTransaction: (txCtx: TTxContext) => object | undefined;

  /** Runs `callback` after `txCtx`'s transaction commits, before the call that opened it settles. */
  onTransactionCommit: (txCtx: TTxContext, callback: () => void | Promise<void>) => void;

  /**
   * Runs `callback` when `txCtx`'s transaction, or the savepoint `txCtx` belongs to, rolls back,
   * before the call that opened the transaction settles. Commit callbacks registered there never
   * run.
   */
  onTransactionRollback: (txCtx: TTxContext, callback: () => void | Promise<void>) => void;

  /**
   * Executes one SQL statement with `?` placeholders and returns its rows, or an empty array for a
   * statement that returns none. When `txCtx` is omitted, runs on a connection of its own.
   *
   * `id` marks a statement worth preparing server-side; without it the provider may use the text
   * protocol. Providers must not enable multiple statements per call.
   *
   * `readOnly` indicates whether the statement writes no rows and takes no row locks (a `SELECT`
   * with no `FOR UPDATE`, `FOR SHARE` or `LOCK IN SHARE MODE`). Providers MAY use this to route to
   * a read replica or a separate reader pool.
   */
  executeSql: (options: {
    txCtx?: TTxContext;
    id?: string;
    sql: string;
    params: unknown[];
    paramTypes: Record<number, RuntimeType>;
    columnTypes: Record<string, RuntimeType>;
    readOnly: boolean;
  }) => Promise<unknown[]>;

  /** Classifies an error thrown by this provider's driver. Returns `undefined` for any other. */
  classifyError: (options: { error: unknown }) => MysqlErrorClassification | undefined;

  /**
   * Releases provider-owned resources. Optional — providers that wrap a caller-owned client or
   * pool can omit it. When defined, must be idempotent.
   */
  close?: () => Promise<void>;
};
