import { BaseTxContext } from "queuert";

/**
 * SQLite state provider interface.
 *
 * Abstracts database client operations, providing context management, transaction handling,
 * and SQL execution. Users create their own implementation to integrate with their preferred
 * SQLite client (better-sqlite3, etc.).
 *
 * @typeParam TTxContext - The transaction context type containing database client/connection info
 */
export type SqliteStateProvider<TTxContext extends BaseTxContext> = {
  /**
   * Executes a callback within a database transaction.
   * Acquires a connection, starts a transaction, executes the callback,
   * commits on success, rolls back on error, and releases the connection.
   */
  runInTransaction: <T>(fn: (txContext: TTxContext) => Promise<T>) => Promise<T>;

  /**
   * Executes a SQL query.
   * When txContext is provided, uses that transaction connection.
   * When txContext is omitted, acquires a connection, executes, and releases.
   * @param options.returns - Whether the query returns rows
   */
  executeSql: (options: {
    txContext?: TTxContext;
    sql: string;
    params?: unknown[];
    returns: boolean;
  }) => Promise<unknown[]>;
};
