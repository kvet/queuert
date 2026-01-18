import { BaseTxContext } from "queuert";

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
  runInTransaction: <T>(fn: (txContext: TTxContext) => Promise<T>) => Promise<T>;

  /**
   * Executes a SQL query.
   * When txContext is provided, uses that transaction connection.
   * When txContext is omitted, acquires a connection from the pool, executes, and releases.
   */
  executeSql: (options: {
    txContext?: TTxContext;
    sql: string;
    params?: unknown[];
  }) => Promise<unknown[]>;
};
