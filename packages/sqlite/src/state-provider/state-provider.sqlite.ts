import type { Mode, ModeResult } from "@queuert/sync-async";
import type { RuntimeType } from "@queuert/typed-sql";
import type { BaseTxContext } from "queuert";

/**
 * The classification of a driver error the SQLite state adapter acts on, as returned by the
 * `classifyError` of a {@link SqliteStateProvider}.
 *
 * - `undefined_table` — a `no such table: <table>` error, with the missing table's name.
 */
export type SqliteErrorClassification = { kind: "undefined_table"; tableName: string };

/**
 * SQLite state provider interface.
 *
 * Abstracts database client operations, providing context management, transaction handling,
 * and SQL execution. Users create their own implementation to integrate with their preferred
 * SQLite client (better-sqlite3, etc.).
 *
 * In the default `"async"` mode, every transaction you pass to `applyJobOutcome` or to client
 * methods must be serialized with the transactions `withTransaction` opens, for example by holding
 * the same `AsyncRwLock` write lock. An unserialized transaction can interleave its statements with
 * the worker's own writes on the same connection.
 *
 * The `"sync"` mode is for drivers that run statements synchronously (better-sqlite3,
 * node:sqlite, bun:sqlite): the provider sets `sync: true` and its members return their results
 * directly. A synchronous transaction cannot interleave with anything else on the thread, so it
 * takes no lock. An `executeSql` without `txCtx` must throw when the connection is already inside
 * a transaction, rather than run inside it.
 *
 * @typeParam TTxContext - The transaction context type containing database client/connection info
 * @typeParam TMode - Whether the members return promises or plain values
 */
export type SqliteStateProvider<TTxContext extends BaseTxContext, TMode extends Mode = "async"> = {
  /** `true` on a synchronous provider; absent or `false` on an asynchronous one. */
  readonly sync?: boolean;

  /**
   * Executes a callback within a database transaction.
   * Acquires a connection, starts a transaction, executes the callback,
   * commits on success, rolls back on error, and releases the connection. In the `"sync"` mode, a
   * `fn` that returns a promise rolls the transaction back and throws.
   */
  withTransaction: <T>(fn: (txCtx: TTxContext) => ModeResult<TMode, T>) => ModeResult<TMode, T>;

  /**
   * The object that identifies the open transaction `txCtx` belongs to, or `undefined` when `txCtx`
   * is not inside an open transaction. Must be synchronous and must not query the database: derive
   * the answer from transaction state the driver or the context already tracks. Every context inside
   * one transaction gives the same object, its savepoints and `retryBoundary` tries included, and
   * every other transaction a different one; a provider that carries `TxHooks` in its transaction
   * context returns them. It is `undefined` once the transaction has ended, in the transaction's own
   * commit and rollback callbacks too, so a driver flag that stays set on a finished transaction is
   * not enough; a savepoint or `retryBoundary` rollback leaves it open.
   */
  getTransaction: (txCtx: TTxContext) => object | undefined;

  /**
   * Runs `callback` after `txCtx`'s transaction commits, before the call that opened it settles.
   * A provider whose driver has no transaction events carries `TxHooks` in its transaction
   * context, creates them in `withTransaction`, and registers `callback` on them.
   */
  onTransactionCommit: (txCtx: TTxContext, callback: () => void | ModeResult<TMode, void>) => void;

  /**
   * Runs `callback` when `txCtx`'s transaction, or the savepoint `txCtx` belongs to, rolls back,
   * before the call that opened the transaction settles. Commit callbacks registered there never
   * run.
   */
  onTransactionRollback: (
    txCtx: TTxContext,
    callback: () => void | ModeResult<TMode, void>,
  ) => void;

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
  classifyError: (options: { error: unknown }) => SqliteErrorClassification | undefined;

  /**
   * Releases provider-owned resources. Optional — providers that wrap a
   * caller-owned connection can omit it. When defined, must be idempotent.
   */
  close?: () => ModeResult<TMode, void>;
} & (TMode extends "sync" ? { readonly sync: true } : { readonly sync?: false });

export type ProviderTxContext<TStateProvider> =
  TStateProvider extends SqliteStateProvider<infer TTxContext, any> ? TTxContext : never;

export type ProviderMode<TStateProvider> =
  TStateProvider extends SqliteStateProvider<any, "sync">
    ? "sync"
    : TStateProvider extends SqliteStateProvider<any>
      ? "async"
      : Mode;
