import type { NotifyAdapter } from "../notify-adapter/notify-adapter.ts";
import type { StateAdapter } from "../state-adapter/state-adapter.ts";

/**
 * The context the state adapter conformance cases run against. Create it once, before the cases.
 * Each case creates the adapters it needs from it, and they are closed when the case ends.
 */
export type StateAdapterConformanceContext = {
  /**
   * Creates an adapter over a clean state: no jobs, blockers or workers, such as by clearing the
   * tables before returning the adapter. The adapters a case creates are closed when it ends, so
   * closing one must not release resources the next one needs.
   */
  createStateAdapter: () => Promise<StateAdapter<any, any, any>>;
  /**
   * Runs the callback with a context of the adapter's shape that is not inside a transaction
   * (e.g. a pool client with no `BEGIN`, or the root ORM handle), so the suite can verify
   * `isTransaction` rejects it.
   */
  withNonTransactionContext: <T>(fn: (txCtx: any) => Promise<T>) => Promise<T>;
  /** Creates the notify adapter an end-to-end case shares; in-process when omitted. */
  createNotifyAdapter?: () => Promise<NotifyAdapter>;
};

/**
 * Context for the schema fence cases: the state adapter context plus a way to fence the
 * adapter's writes. Only adapters that fence writes behind a schema fence table run these cases.
 */
export type SchemaFenceConformanceContext = StateAdapterConformanceContext & {
  /**
   * Fences the adapter's writes while the callback runs, as a later breaking migration would,
   * then lifts the fence: drop the fence table, run the callback, recreate it. The cases use it
   * to verify that every write fails with `SchemaFencedError` and changes nothing, and that
   * reads and deletes keep working.
   */
  withWritesFenced: <T>(fn: () => Promise<T>) => Promise<T>;
};

/**
 * Context for the savepoint cases: the state adapter context plus an optional way to run a callback
 * inside a savepoint of an open transaction, the way the application opens one. Without it the
 * savepoint cases pass without checking anything.
 */
export type SavepointConformanceContext = StateAdapterConformanceContext & {
  /**
   * Runs `fn` in a savepoint of `txCtx`'s transaction and passes it the savepoint's context:
   * releases the savepoint when `fn` resolves and rolls it back when `fn` throws, then rethrows.
   */
  withSavepoint?: <T>(txCtx: any, fn: (txCtx: any) => Promise<T>) => Promise<T>;
};
