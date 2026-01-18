import { type Collection } from "mongodb";
import { BaseTxContext } from "queuert";

/**
 * MongoDB state provider interface.
 *
 * Abstracts database client operations, providing context management, transaction handling,
 * and collection access. Users create their own implementation to integrate with their
 * MongoDB client.
 *
 * @typeParam TTxContext - The transaction context type containing session info
 */
export type MongoStateProvider<TTxContext extends BaseTxContext> = {
  /**
   * Executes a callback within a database transaction.
   * Acquires a session, starts a transaction, executes the callback,
   * commits on success, aborts on error, and ends the session.
   */
  runInTransaction: <T>(fn: (txContext: TTxContext) => Promise<T>) => Promise<T>;

  /**
   * Gets the MongoDB collection for job storage.
   * When txContext is provided, uses that transaction session for the operation.
   * When txContext is omitted, returns a collection without session binding.
   */
  getCollection: (txContext?: TTxContext) => Collection;
};
