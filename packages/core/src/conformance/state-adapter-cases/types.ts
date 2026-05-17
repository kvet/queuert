import { type StateAdapter } from "../../state-adapter/state-adapter.js";

export type StateAdapterConformanceContext = {
  stateAdapter: StateAdapter<any, any>;
  /** Generates a valid job ID matching the adapter's configured `generateId` / `validateId`. Used by tests that exercise the caller-supplied `id` path. */
  generateId?: () => string;
  /** Generates an ID that the adapter's `validateId` predicate must reject. Supply this when the adapter is configured with a `validateId` so the conformance suite can verify the rejection path; cases that need it are skipped when this is absent. */
  generateInvalidId?: () => string;
  poisonTransaction?: (txCtx: any) => Promise<void>;
};
