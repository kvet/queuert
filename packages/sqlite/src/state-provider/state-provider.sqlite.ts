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
   * When `columnTypes` is non-empty the query returns rows (use `.all()`);
   * when empty the query is a mutation (use `.run()` / `.exec()`).
   */
  executeSql: (options: {
    txCtx?: TTxContext;
    sql: string;
    params?: unknown[];
    columnTypes: Record<string, RuntimeType>;
  }) => Promise<unknown[]>;
};
