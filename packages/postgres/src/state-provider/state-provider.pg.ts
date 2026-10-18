import { type RuntimeType } from "@queuert/typed-sql";
import { type BaseTxContext } from "queuert";

/**
 * PostgreSQL state provider interface.
 *
 * Abstracts database client operations, providing context management, transaction handling,
 * and SQL execution. Users create their own implementation to integrate with their preferred
 * client (raw `pg`, Drizzle, Prisma, etc.).
 *
 * @typeParam TTxContext - The transaction context type containing database client/connection info
 */
export type PgStateProvider<TTxContext extends BaseTxContext> = {
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
   * When txCtx is omitted, acquires a connection from the pool, executes, and releases.
   *
   * `id` is a stable cache key for server-side prepared statements. It uniquely
   * identifies the resolved SQL within this provider instance (the adapter folds
   * template variants like `schema` / `tablePrefix` into the suffix), so providers
   * MAY use it directly as the prepared-statement name or as a signal to opt into
   * driver-level statement caching. When omitted, the provider must execute the
   * statement unprepared — the adapter omits `id` for one-off or dynamic SQL (e.g. savepoints).
   *
   * `paramTypes` / `columnTypes` are type hints for drivers that don't serialize parameters
   * or parse result columns themselves. Drivers that handle these natively can ignore them.
   *
   * `readOnly` indicates whether the statement reads only (pure `SELECT` with no `FOR UPDATE`).
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
   * Releases provider-owned resources. Optional — providers that wrap a
   * caller-owned client or pool can omit it. When defined, must be idempotent.
   */
  close?: () => Promise<void>;
};
