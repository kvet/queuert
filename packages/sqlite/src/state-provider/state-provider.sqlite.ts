import type { RuntimeType } from "@queuert/typed-sql";
import type { BaseTxContext } from "queuert";

/**
 * A driver error the SQLite state adapter acts on, as classified by
 * {@link SqliteStateProvider.classifyError}.
 *
 * - `undefined_table` — a `no such table: <table>` error, with the missing table's name.
 *
 * @experimental
 */
export type SqliteStateProviderError = { kind: "undefined_table"; tableName: string };

/**
 * SQLite state provider interface.
 *
 * Abstracts database client operations, providing context management, transaction handling,
 * and SQL execution. Users create their own implementation to integrate with their preferred
 * SQLite client (better-sqlite3, etc.).
 *
 * Every transaction you pass to `complete` or to client methods must be serialized with the
 * transactions `withTransaction` opens, for example by holding the same `AsyncRwLock` write
 * lock. An unserialized transaction can interleave its statements with the worker's own writes on
 * the same connection.
 *
 * @typeParam TTxContext - The transaction context type containing database client/connection info
 * @experimental
 */
export type SqliteStateProvider<TTxContext extends BaseTxContext> = {
  /**
   * Executes a callback within a database transaction.
   * Acquires a connection, starts a transaction, executes the callback,
   * commits on success, rolls back on error, and releases the connection.
   */
  withTransaction: <T>(fn: (txCtx: TTxContext) => Promise<T>) => Promise<T>;

  /**
   * Whether `txCtx` is inside an open transaction. Must be synchronous and must not query the
   * database — derive the answer from transaction state the driver or the context already tracks.
   */
  isTransaction: (txCtx: TTxContext) => boolean;

  /**
   * Runs `callback` after `txCtx`'s transaction commits, before the call that opened it settles.
   * A provider whose driver has no transaction events carries `TxHooks` in its transaction context, creates them
   * in `withTransaction`, and registers `callback` on them.
   */
  onTransactionCommit: (txCtx: TTxContext, callback: () => void | Promise<void>) => void;

  /**
   * Runs `callback` synchronously when `txCtx`'s transaction, or the savepoint `txCtx` belongs to,
   * rolls back. Commit callbacks registered there never run.
   */
  onTransactionRollback: (txCtx: TTxContext, callback: () => void) => void;

  /**
   * Executes a SQL query.
   * When txCtx is provided, uses that transaction connection.
   * When txCtx is omitted, acquires a connection, executes, and releases.
   *
   * `id` is a stable cache key for prepared statements. It uniquely identifies
   * the resolved SQL within this provider instance (the adapter folds template
   * variants like `tablePrefix` into the suffix), so providers MAY cache prepared
   * statement handles by `id` alone. When omitted, the provider must execute the
   * statement unprepared — the adapter omits `id` for one-off or dynamic SQL.
   *
   * When `columnTypes` is non-empty the query returns rows; when empty the query is
   * a mutation and the provider may return an empty array.
   *
   * `paramTypes` annotates each positional parameter's runtime type. The adapter
   * pre-serializes non-primitive values to strings before they reach the provider,
   * so providers MAY ignore this field. It exists for drivers that need explicit
   * type hints.
   *
   * `readOnly` indicates whether the statement reads only (SELECT without FOR UPDATE).
   * Providers MAY use this to pick between shared/exclusive locks or reader/writer connections.
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
   * does not recognize. SQLite drivers report a missing table as `no such table: <name>` in the
   * message of the error or its `cause`.
   */
  classifyError: (options: { error: unknown }) => SqliteStateProviderError | undefined;

  /**
   * Releases provider-owned resources. Optional — providers that wrap a
   * caller-owned connection can omit it. When defined, must be idempotent.
   */
  close?: () => Promise<void>;
};
