import type { RuntimeType } from "@queuert/typed-sql";
import type { BaseTxContext } from "queuert";

/**
 * The classification of a driver error the MySQL state adapter acts on, as returned by
 * {@link MysqlStateProvider.classifyError}.
 *
 * - `undefined_table` — error 1146 (`ER_NO_SUCH_TABLE`), with the missing table's qualified name as
 *   the server reports it (`Table '<database>.<table>' doesn't exist`).
 *
 * @experimental
 */
export type MysqlErrorClassification = { kind: "undefined_table"; tableName: string };

/**
 * MySQL and MariaDB state provider interface.
 *
 * Abstracts database client operations, providing context management, transaction handling,
 * and SQL execution. Users create their own implementation to integrate with their preferred
 * client (`mysql2`, `mariadb`, Drizzle, Kysely, etc.).
 *
 * Every connection must have a default database selected, even when the adapter's `schema` names
 * another one: MySQL rejects multi-table updates over `JSON_TABLE` on a connection without one.
 *
 * @typeParam TTxContext - The transaction context type containing database client/connection info
 *
 * @experimental
 */
export type MysqlStateProvider<TTxContext extends BaseTxContext> = {
  /**
   * Executes a callback within a database transaction at READ COMMITTED: issues
   * `SET TRANSACTION ISOLATION LEVEL READ COMMITTED` and then opens the transaction on the same
   * connection with nothing between them (`START TRANSACTION`, or `SET autocommit = 0` for a
   * provider that pipelines), commits on success, rolls back on error, and releases the
   * connection.
   */
  withTransaction: <T>(fn: (txCtx: TTxContext) => Promise<T>) => Promise<T>;

  /**
   * Whether `txCtx` is inside an open transaction. Must be synchronous and must not query the
   * database.
   */
  isTransaction: (txCtx: TTxContext) => boolean;

  /** Runs `callback` after `txCtx`'s transaction commits, before the call that opened it settles. */
  onTransactionCommit: (txCtx: TTxContext, callback: () => void | Promise<void>) => void;

  /**
   * Runs `callback` synchronously when `txCtx`'s transaction, or the savepoint `txCtx` belongs to,
   * rolls back. Commit callbacks registered there never run.
   */
  onTransactionRollback: (txCtx: TTxContext, callback: () => void) => void;

  /**
   * Executes a batch of SQL statements with `?` placeholders in order, each one seeing the
   * effects of the ones before it, and returns one row array per statement, in statement order,
   * with an empty array for a statement that returns no rows. When `txCtx` is provided, runs on
   * that transaction's connection. When it is omitted, each statement autocommits on its own: a
   * provider that runs the statements one at a time may use any connection for each, and one that
   * pipelines sends the batch on one connection it acquires.
   *
   * The provider may send the batch pipelined, issuing every statement without awaiting between
   * them, or run it statement by statement. A pipelining provider waits for every statement to
   * settle and throws the first rejection in statement order. When a statement fails, the call
   * rejects with that statement's driver error, the first failure in statement order; whether
   * later statements ran is unspecified, and inside a transaction the caller rolls it back.
   *
   * A provider that pipelines opens its transactions with `SET autocommit = 0` and restores it
   * after COMMIT or ROLLBACK, instead of `START TRANSACTION`: when a deadlock makes InnoDB roll
   * the transaction back while the rest of a batch is in flight, those statements then open a new
   * implicit transaction that the provider's ROLLBACK discards, rather than autocommit.
   *
   * `id` marks a statement worth preparing server-side; without it the provider may use the text
   * protocol. Providers must not enable multiple statements per call. A provider MAY route a batch
   * to a replica only when every statement in it is `readOnly`.
   */
  executeStatements: (options: {
    txCtx?: TTxContext;
    statements: {
      id?: string;
      sql: string;
      params: unknown[];
      paramTypes: Record<number, RuntimeType>;
      columnTypes: Record<string, RuntimeType>;
      readOnly: boolean;
    }[];
  }) => Promise<unknown[][]>;

  /** Classifies an error thrown by this provider's driver. Returns `undefined` for any other. */
  classifyError: (options: { error: unknown }) => MysqlErrorClassification | undefined;

  /**
   * Releases provider-owned resources. Optional — providers that wrap a caller-owned client or
   * pool can omit it. When defined, must be idempotent.
   */
  close?: () => Promise<void>;
};
