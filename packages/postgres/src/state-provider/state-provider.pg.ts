import type { RuntimeType } from "@queuert/typed-sql";
import type { BaseTxContext } from "queuert";

/**
 * The classification of a driver error the PostgreSQL state adapter acts on, as returned by
 * {@link PgStateProvider.classifyError}.
 *
 * - `undefined_table` — SQLSTATE `42P01`, with the missing relation's name as the server reports it
 *   (`relation "<table>" does not exist`). Without the name the adapter cannot tell its fence
 *   apart from another missing table, so a provider that cannot read it returns `undefined`.
 */
export type PgErrorClassification = { kind: "undefined_table"; tableName: string };

/**
 * PostgreSQL state provider interface.
 *
 * Abstracts database client operations, providing context management, transaction handling,
 * and SQL execution. Users create their own implementation to integrate with their preferred
 * client (raw `pg`, Drizzle, Prisma, etc.).
 *
 * Queuert supports only READ COMMITTED (the default).
 *
 * @typeParam TTxContext - The transaction context type containing database client/connection info
 */
export type PgStateProvider<TTxContext extends BaseTxContext> = {
  /**
   * Executes a callback within a database transaction at READ COMMITTED, the only isolation level
   * Queuert supports. Acquires a connection, starts the transaction with the level stated
   * explicitly (`BEGIN ISOLATION LEVEL READ COMMITTED`), so a server or role whose
   * `default_transaction_isolation` is higher cannot raise it, executes the callback, commits on
   * success, rolls back on error, and releases the connection.
   */
  withTransaction: <T>(fn: (txCtx: TTxContext) => Promise<T>) => Promise<T>;

  /**
   * Whether `txCtx` is inside an open transaction. Must be synchronous and must not query the
   * database — derive the answer from transaction state the driver or the context already tracks.
   */
  isTransaction: (txCtx: TTxContext) => boolean;

  /**
   * Runs `callback` after `txCtx`'s transaction commits, before the call that opened it settles.
   * A provider whose driver has no transaction events carries `TxHooks` in its transaction
   * context, creates them in `withTransaction`, and registers `callback` on them.
   */
  onTransactionCommit: (txCtx: TTxContext, callback: () => void | Promise<void>) => void;

  /**
   * Runs `callback` synchronously when `txCtx`'s transaction, or the savepoint `txCtx` belongs to,
   * rolls back. Commit callbacks registered there never run.
   */
  onTransactionRollback: (txCtx: TTxContext, callback: () => void) => void;

  /**
   * Executes a batch of SQL statements in order, each one seeing the effects of the ones
   * before it, and returns one row array per statement, in statement order. When `txCtx`
   * is provided, runs on that transaction's connection. When it is omitted, each statement
   * autocommits on its own: a provider that runs the statements one at a time may use any
   * connection for each, and one that pipelines sends the batch on one connection it acquires.
   *
   * The provider may send the batch pipelined, issuing every statement without awaiting between
   * them, or run it statement by statement. A pipelining provider waits for every statement to
   * settle and throws the first rejection in statement order. When a statement fails, the call
   * rejects with that statement's driver error, the first failure in statement order; whether
   * later statements ran is unspecified, and inside a transaction the caller rolls it back.
   *
   * `id` is a stable cache key for server-side prepared statements. It uniquely identifies the
   * resolved SQL within this provider instance (the adapter folds template variants like `schema`
   * / `tablePrefix` into the suffix), so providers MAY use it directly as the prepared-statement
   * name or as a signal to opt into driver-level statement caching. When omitted, the provider
   * must execute the statement unprepared — the adapter omits `id` for one-off or dynamic SQL.
   *
   * `paramTypes` / `columnTypes` are type hints for drivers that don't serialize parameters or
   * parse result columns themselves. Drivers that handle these natively can ignore them.
   *
   * `readOnly` indicates whether the statement reads only (pure `SELECT` with no `FOR UPDATE`). A
   * provider MAY route a batch to a read replica or a separate reader pool only when every
   * statement in it is `readOnly`.
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

  /**
   * Classifies an error thrown by this provider's driver. Returns `undefined` for an error it
   * does not recognize. Most drivers expose the SQLSTATE as `code` on the error or its `cause`.
   */
  classifyError: (options: { error: unknown }) => PgErrorClassification | undefined;

  /**
   * Releases provider-owned resources. Optional — providers that wrap a
   * caller-owned client or pool can omit it. When defined, must be idempotent.
   */
  close?: () => Promise<void>;
};
