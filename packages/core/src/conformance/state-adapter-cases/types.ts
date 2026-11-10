import type { StateAdapter } from "../../state-adapter/state-adapter.ts";

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
};
