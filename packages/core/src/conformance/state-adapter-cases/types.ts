import { type StateAdapter } from "../../state-adapter/state-adapter.js";

/**
 * Fixture for the state adapter conformance suite. Used both as the factory
 * return shape for {@link runStateAdapterConformance} and as the per-case
 * context the conformance cases receive.
 */
export type StateConformanceFixture = {
  stateAdapter: StateAdapter<any, any>;
  /**
   * Whether two `withTransaction` callbacks can run at the same time — `"concurrent"` for a
   * connection pool, `"serialized"` for a single connection (e.g. SQLite). Cases that need
   * concurrent transactions run only when this is `"concurrent"`.
   */
  transactionConcurrency: "concurrent" | "serialized";
  /**
   * Runs the callback with a context of the adapter's shape that is not inside a transaction
   * (e.g. a pool client with no `BEGIN`, or the root ORM handle), so the suite can verify
   * `isTransaction` rejects it. Cases that need it are skipped when omitted.
   */
  withNonTransactionContext?: <T>(fn: (txCtx: any) => Promise<T>) => Promise<T>;
  /**
   * Called before each conformance case to restore a clean state. Typically
   * `() => adapter.truncate()`. Consumed by the runner — cases ignore it.
   */
  reset?: () => Promise<void>;
  /**
   * Called once after all cases finish (pass or fail) to release resources.
   * Consumed by the runner — cases ignore it.
   */
  dispose?: () => Promise<void>;
};
