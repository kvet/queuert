import { type RuntimeType } from "@queuert/typed-sql";
import { type BaseTxContext } from "queuert";

/**
 * SQLite state provider interface.
 *
 * Abstracts database client operations, providing context management, transaction handling,
 * and SQL execution. Users create their own implementation to integrate with their preferred
 * SQLite client (better-sqlite3, etc.).
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
   * Executes a callback within a savepoint inside an existing transaction.
   * Creates a savepoint, executes the callback, releases on success,
   * rolls back to the savepoint on error.
   *
   * Optional. When not provided, the adapter uses raw SAVEPOINT SQL via executeSql.
   * Override when the driver tracks transaction state client-side.
   */
  withSavepoint?: <T>(txCtx: TTxContext, fn: (txCtx: TTxContext) => Promise<T>) => Promise<T>;

  /**
   * Executes a SQL query.
   * When txCtx is provided, uses that transaction connection.
   * When txCtx is omitted, acquires a connection, executes, and releases.
   *
   * `id` is a stable cache key for prepared statements. It uniquely identifies
   * the resolved SQL within this provider instance (the adapter folds template
   * variants like `tablePrefix` into the suffix), so providers MAY cache prepared
   * statement handles by `id` alone. When omitted, the provider must execute the
   * statement unprepared — the adapter omits `id` for one-off or dynamic SQL (e.g. savepoints).
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
   * Releases provider-owned resources. Optional — providers that wrap a
   * caller-owned connection can omit it. When defined, must be idempotent.
   */
  close?: () => Promise<void>;
};
