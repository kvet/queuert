import { type StateAdapter } from "../../state-adapter/state-adapter.js";

/**
 * Fixture for the state adapter conformance suite. Used both as the factory
 * return shape for {@link runStateAdapterConformance} and as the per-case
 * context the conformance cases receive.
 */
export type StateConformanceFixture = {
  stateAdapter: StateAdapter<any, any>;
  /** Generates a valid job ID matching the adapter's configured `generateId` / `validateId`. Used by tests that exercise the caller-supplied `id` path. */
  generateId?: () => string;
  /** Generates an ID that the adapter's `validateId` predicate must reject. Supply this when the adapter is configured with a `validateId` so the conformance suite can verify the rejection path; cases that need it are skipped when this is absent. */
  generateInvalidId?: () => string;
  /** Forces the active transaction into an aborted state (e.g. `SELECT 1 FROM nonexistent_table`). Cases that need it are skipped when omitted. SQLite does not support mid-tx poisoning. */
  poisonTransaction?: (txCtx: any) => Promise<void>;
  /** Called before each conformance case to restore a clean state. Typically `() => adapter.truncate()`. Consumed by the runner — cases ignore it. */
  reset?: () => Promise<void>;
  /** Called once after all cases finish (pass or fail) to release resources. Consumed by the runner — cases ignore it. */
  dispose?: () => Promise<void>;
};
