import type { RuntimeType } from "@queuert/typed-sql/sql";
import type { AdapterMode, BaseTxContext, ModeResult } from "queuert";

/**
 * A driver error the SQLite state adapter acts on, as classified by
 * {@link SqliteStateProvider.classifyError}.
 *
 * - `undefined_table` — a `no such table: <table>` error, with the missing table's name.
 */
export type SqliteStateProviderError = { kind: "undefined_table"; tableName: string };

/**
 * The members every SQLite state provider implements, in either mode: `"async"` members return
 * promises, `"sync"` members return their results directly and throw.
 *
 * @typeParam TTxContext - The transaction context type containing database client/connection info
 * @typeParam TMode - Whether the members return promises or plain values
 */
export type SqliteStateProviderOperations<
  TTxContext extends BaseTxContext,
  TMode extends AdapterMode,
> = {
  /**
   * Executes a callback within a database transaction.
   * Acquires a connection, starts a transaction, executes the callback,
   * commits on success, rolls back on error, and releases the connection. In the `"sync"` mode, a
   * `fn` that returns a promise rolls the transaction back and throws.
   */
  withTransaction: <T>(fn: (txCtx: TTxContext) => ModeResult<TMode, T>) => ModeResult<TMode, T>;

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
  onTransactionCommit: (txCtx: TTxContext, callback: () => void | ModeResult<TMode, void>) => void;

  /**
   * Runs `callback` synchronously when `txCtx`'s transaction, or the savepoint `txCtx` belongs to,
   * rolls back. Commit callbacks registered there never run.
   */
  onTransactionRollback: (txCtx: TTxContext, callback: () => void) => void;

  /**
   * Executes a SQL query.
   * When txCtx is provided, uses that transaction connection.
   * When txCtx is omitted, acquires a connection, executes, and releases.
   *
   * `id` is a stable cache key for prepared statements. It uniquely identifies
   * the resolved SQL within this provider instance (the adapter folds template
   * variants like `tablePrefix` into the suffix), so providers MAY cache prepared
   * statement handles by `id` alone. When omitted, the provider must execute the
   * statement unprepared — the adapter omits `id` for one-off or dynamic SQL.
   *
   * When `columnTypes` is non-empty the query returns rows; when empty the query is
   * a mutation and the provider may return an empty array.
   *
   * `paramTypes` annotates each positional parameter's runtime type. The adapter
   * pre-serializes non-primitive values to strings before they reach the provider,
   * so providers MAY ignore this field. It exists for drivers that need explicit
   * type hints.
   *
   * `readOnly` indicates whether the statement reads only (SELECT without FOR UPDATE).
   * Providers MAY use this to pick between shared/exclusive locks or reader/writer connections.
   */
  executeSql: (options: {
    txCtx?: TTxContext;
    id?: string;
    sql: string;
    params: unknown[];
    paramTypes: Record<number, RuntimeType>;
    columnTypes: Record<string, RuntimeType>;
    readOnly: boolean;
  }) => ModeResult<TMode, unknown[]>;

  /**
   * Classifies an error thrown by this provider's driver. Returns `undefined` for an error it
   * does not recognize. SQLite drivers report a missing table as `no such table: <name>` in the
   * message of the error or its `cause`.
   */
  classifyError: (options: { error: unknown }) => SqliteStateProviderError | undefined;

  /**
   * Releases provider-owned resources. Optional — providers that wrap a
   * caller-owned connection can omit it. When defined, must be idempotent.
   */
  close?: () => ModeResult<TMode, void>;
};

/**
 * SQLite state provider interface.
 *
 * Abstracts database client operations, providing context management, transaction handling,
 * and SQL execution. Users create their own implementation to integrate with their preferred
 * SQLite client (better-sqlite3, etc.).
 *
 * Every transaction you pass to `complete` or to client methods must be serialized with the
 * transactions `withTransaction` opens, for example by holding the same `AsyncRwLock` write
 * lock. An unserialized transaction can interleave its statements with the worker's own writes on
 * the same connection.
 *
 * @typeParam TTxContext - The transaction context type containing database client/connection info
 */
export type SqliteStateProvider<TTxContext extends BaseTxContext> = SqliteStateProviderOperations<
  TTxContext,
  "async"
>;

/**
 * Synchronous variant of {@link SqliteStateProvider}, marked with `sync: true`.
 *
 * For drivers that run statements synchronously (better-sqlite3, node:sqlite, bun:sqlite). A
 * synchronous transaction cannot interleave with anything else on the thread, so it takes no lock.
 * An `executeSql` without `txCtx` must throw when the connection is already inside a transaction,
 * rather than run inside it.
 *
 * @typeParam TTxContext - The transaction context type containing database client/connection info
 */
export type SyncSqliteStateProvider<TTxContext extends BaseTxContext> =
  SqliteStateProviderOperations<TTxContext, "sync"> & {
    /** Marks the provider as synchronous. */
    readonly sync: true;
  };

export type AnySqliteStateProvider<TTxContext extends BaseTxContext> =
  | SqliteStateProvider<TTxContext>
  | SyncSqliteStateProvider<TTxContext>;

/** A provider of either mode, seen through the members both modes share. */
export type ModeSqliteStateProvider<TTxContext extends BaseTxContext> =
  SqliteStateProviderOperations<TTxContext, AdapterMode>;
