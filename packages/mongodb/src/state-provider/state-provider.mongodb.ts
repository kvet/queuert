import { type ClientSession, type Collection } from "mongodb";
import { type BaseTxContext } from "queuert";

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
   */
  getCollection: () => Collection;

  /**
   * Extracts the native MongoDB ClientSession from the transaction context.
   * This allows different MongoDB clients (native driver, Mongoose, etc.)
   * to use their own session types while the adapter uses the native type internally.
   */
  getSession: (txContext: TTxContext | undefined) => ClientSession | undefined;
};
