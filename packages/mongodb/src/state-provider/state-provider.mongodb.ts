import { type Collection } from "mongodb";
import { BaseStateAdapterContext } from "queuert";

/**
 * MongoDB state provider interface.
 *
 * Abstracts database client operations, providing context management, transaction handling,
 * and collection access. Users create their own implementation to integrate with their
 * MongoDB client.
 *
 * @typeParam TTxContext - Transaction context type, used within `runInTransaction` callbacks
 * @typeParam TContext - General context type, provided by `provideContext`. Defaults to TTxContext.
 *
 * When TTxContext !== TContext, operations like migrations can run outside transactions.
 */
export type MongoStateProvider<
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
   * Gets the MongoDB collection for job storage.
   * Accepts either transaction context or general context.
   */
  getCollection: (context: TTxContext | TContext) => Collection;

  /**
   * Checks if the given context is within a transaction.
   * Useful when TTxContext extends TContext and it's easy to confuse them.
   */
  isInTransaction: (context: TTxContext | TContext) => Promise<boolean>;
};
