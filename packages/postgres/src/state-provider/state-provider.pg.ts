import type { RuntimeType } from "@queuert/typed-sql";
import type { BaseTxContext } from "queuert";

/**
 * The classification of a driver error the PostgreSQL state adapter acts on, as returned by
 * {@link PgStateProvider.classifyError}.
 *
 * - `undefined_table` — SQLSTATE `42P01`, with the missing relation's name as the server reports it
 *   (`relation "<table>" does not exist`). Without the name the adapter cannot tell its fence
 *   apart from another missing table, so a provider that cannot read it returns `undefined`.
 * - `transaction_conflict` — SQLSTATE `40001` (`serialization_failure`), raised at REPEATABLE READ
 *   and SERIALIZABLE, or `40P01` (`deadlock_detected`), raised at any level; PostgreSQL rolls the
 *   whole transaction back for both. The adapter retries it in the transactions and statements it runs without a
 *   caller's transaction; a provider that does not report it leaves it unretried.
 */
export type PgErrorClassification =
  | { kind: "undefined_table"; tableName: string }
  | { kind: "transaction_conflict" };

/**
 * PostgreSQL state provider interface.
 *
 * Abstracts database client operations, providing context management, transaction handling,
 * and SQL execution. Users create their own implementation to integrate with their preferred
 * client (raw `pg`, Drizzle, Prisma, etc.).
 *
 * Queuert supports READ COMMITTED, REPEATABLE READ and SERIALIZABLE, as a session default or per
 * transaction, including mixed levels.
 *
 * @typeParam TTxContext - The transaction context type containing database client/connection info
 */
export type PgStateProvider<TTxContext extends BaseTxContext> = {
  /**
   * Executes a callback within a database transaction. Acquires a connection, starts the
   * transaction at the connection's default isolation level (a plain `BEGIN`), executes the
   * callback, commits on success, rolls back on error, and releases the connection. Migrations set
   * READ COMMITTED on the transactions they open with `SET TRANSACTION`, which must be the
   * transaction's first statement, so run no statement in it before the callback.
   */
  withTransaction: <T>(fn: (txCtx: TTxContext) => Promise<T>) => Promise<T>;

  /**
   * Whether `txCtx` is inside an open transaction. Must be synchronous and must not query the
   * database — derive the answer from transaction state the driver or the context already tracks.
   */
  isTransaction: (txCtx: TTxContext) => boolean;

  /**
   * Runs `callback` after `txCtx`'s transaction commits, before the call that opened it settles.
   * A provider whose driver has no transaction events carries `TxHooks` in its transaction
   * context, creates them in `withTransaction`, and registers `callback` on them.
   */
  onTransactionCommit: (txCtx: TTxContext, callback: () => void | Promise<void>) => void;

  /**
   * Runs `callback` when `txCtx`'s transaction, or the savepoint `txCtx` belongs to, rolls back,
   * before the call that opened the transaction settles. Commit callbacks registered there never
   * run.
   */
  onTransactionRollback: (txCtx: TTxContext, callback: () => void | Promise<void>) => void;

  /**
   * Executes a SQL query.
   * When txCtx is provided, uses that transaction connection.
   * When txCtx is omitted, acquires a connection from the pool, executes, and releases.
   *
   * `id` is a stable cache key for server-side prepared statements. It uniquely
   * identifies the resolved SQL within this provider instance (the adapter folds
   * template variants like `schema` / `tablePrefix` into the suffix), so providers
   * MAY use it directly as the prepared-statement name or as a signal to opt into
   * driver-level statement caching. When omitted, the provider must execute the
   * statement unprepared — the adapter omits `id` for one-off or dynamic SQL.
   *
   * `paramTypes` / `columnTypes` are type hints for drivers that don't serialize parameters
   * or parse result columns themselves. Drivers that handle these natively can ignore them.
   *
   * `readOnly` indicates whether the statement writes no rows and takes no row locks (a `SELECT`
   * with no `FOR UPDATE`, or a transaction setting such as `SET TRANSACTION`).
   * Providers MAY use this to route to a read replica or a separate reader pool.
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

  /**
   * Classifies an error thrown by this provider's driver. Returns `undefined` for an error it
   * does not recognize. Most drivers expose the SQLSTATE as `code` on the error or its `cause`.
   */
  classifyError: (options: { error: unknown }) => PgErrorClassification | undefined;

  /**
   * Releases provider-owned resources. Optional — providers that wrap a
   * caller-owned client or pool can omit it. When defined, must be idempotent.
   */
  close?: () => Promise<void>;
};
