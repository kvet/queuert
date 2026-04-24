import { type RuntimeType } from "@queuert/typed-sql";
import { type BaseTxContext } from "queuert/internal";

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
   * Executes a callback within a savepoint inside an existing transaction.
   * Creates a savepoint, executes the callback, releases on success,
   * rolls back to the savepoint on error.
   *
   * Optional. When not provided, the adapter uses raw SAVEPOINT SQL via executeSql.
   * Override when the driver tracks transaction state client-side (e.g. postgres.js).
   */
  withSavepoint?: <T>(txCtx: TTxContext, fn: (txCtx: TTxContext) => Promise<T>) => Promise<T>;

  /**
   * Executes a SQL query.
   * When txCtx is provided, uses that transaction connection.
   * When txCtx is omitted, acquires a connection from the pool, executes, and releases.
   *
   * Type hints enable drivers that don't auto-serialize/parse (e.g. postgres.js `unsafe()`)
   * to handle json/jsonb columns and array parameters correctly.
   * Drivers that handle these natively (e.g. `pg`) can ignore the hints.
   *
   * `readOnly` indicates whether the statement reads only (pure `SELECT` with no `FOR UPDATE`).
   * Providers can use this to route to a read replica or a separate reader pool. The built-in
   * pool/postgres-js providers ignore it.
   */
  executeSql: (options: {
    txCtx?: TTxContext;
    sql: string;
    params: unknown[];
    paramTypes: Record<number, RuntimeType>;
    columnTypes: Record<string, RuntimeType>;
    readOnly: boolean;
  }) => Promise<unknown[]>;
};
