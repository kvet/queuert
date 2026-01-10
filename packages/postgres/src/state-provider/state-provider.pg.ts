import { BaseStateAdapterContext } from "queuert";

/**
 * PostgreSQL state provider interface.
 *
 * Abstracts database client operations, providing context management, transaction handling,
 * and SQL execution. Users create their own implementation to integrate with their preferred
 * client (raw `pg`, Drizzle, Prisma, etc.).
 *
 * @typeParam TTxContext - Transaction context type, used within `runInTransaction` callbacks
 * @typeParam TContext - General context type, provided by `provideContext`. Defaults to TTxContext.
 *
 * When TTxContext !== TContext, operations like migrations can run outside transactions,
 * enabling PostgreSQL operations like `CREATE INDEX CONCURRENTLY`.
 */
export type PgStateProvider<
  TTxContext extends BaseStateAdapterContext,
  TContext extends BaseStateAdapterContext = TTxContext,
> = {
  /**
   * Provides a database context for operations.
   * The context may or may not be within a transaction depending on implementation.
   */
  provideContext: <T>(fn: (context: TContext) => Promise<T>) => Promise<T>;

  /**
   * Executes a callback within a database transaction.
   * @param context - The general context (from provideContext)
   * @param fn - Callback receiving transaction context
   */
  runInTransaction: <T>(context: TContext, fn: (context: TTxContext) => Promise<T>) => Promise<T>;

  /**
   * Executes a SQL query.
   * Accepts either transaction context or general context.
   */
  executeSql: (
    context: TTxContext | TContext,
    query: string,
    params?: unknown[],
  ) => Promise<unknown[]>;

  /**
   * Checks if the given context is within a transaction.
   * Useful when TTxContext extends TContext and it's easy to confuse them.
   */
  isInTransaction: (context: TTxContext | TContext) => Promise<boolean>;
};
