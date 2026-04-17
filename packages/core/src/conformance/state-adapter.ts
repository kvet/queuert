import { type StateAdapter } from "../state-adapter/state-adapter.js";
import { type ConformanceReport, type ConformanceResult, runConformance } from "./runner.js";
import {
  type StateAdapterConformanceContext,
  stateAdapterConformanceGroups,
} from "./state-adapter-cases.js";

/**
 * Fixture returned by the factory passed to {@link runStateAdapterConformance}.
 *
 * - **stateAdapter** — the adapter under test.
 * - **poisonTransaction** — optional. Forces the active transaction into an
 *   aborted state (e.g. `SELECT 1 FROM nonexistent_table`). Cases that need it
 *   are skipped when omitted. SQLite does not support mid-tx poisoning.
 * - **reset** — optional. Called before each conformance case to restore a
 *   clean state. Typically `() => adapter.truncate()`.
 * - **dispose** — optional. Called once after all cases finish (pass or fail)
 *   to release resources (close connections, stop containers).
 */
export type StateConformanceFixture = {
  stateAdapter: StateAdapter<any, any>;
  poisonTransaction?: (txCtx: any) => Promise<void>;
  reset?: () => Promise<void>;
  dispose?: () => Promise<void>;
};

export type StateConformanceOptions = {
  caseTimeoutMs?: number;
  onResult?: (result: ConformanceResult) => void;
};

/**
 * Run the state adapter conformance suite against a user-supplied adapter.
 * Test-framework agnostic: designed to be embedded in a single test
 * (vitest `test()`, bun `test()`, `node:test`, etc.). Throws
 * {@link ConformanceError} with an aggregated report on any failure.
 *
 * @example
 * ```ts
 * await runStateAdapterConformance(async () => {
 *   const adapter = await createMyStateAdapter();
 *   await adapter.migrateToLatest();
 *   return {
 *     stateAdapter: adapter,
 *     reset: async () => adapter.truncate(),
 *     dispose: async () => adapter.close(),
 *   };
 * });
 * ```
 */
export const runStateAdapterConformance = async (
  factory: () => Promise<StateConformanceFixture>,
  options?: StateConformanceOptions,
): Promise<ConformanceReport> => {
  const fixture = await factory();
  try {
    return await runConformance(stateAdapterConformanceGroups, {
      setup: async () => {
        if (fixture.reset) await fixture.reset();
        return {
          context: {
            stateAdapter: fixture.stateAdapter,
            poisonTransaction: fixture.poisonTransaction,
          } satisfies StateAdapterConformanceContext,
        };
      },
      caseTimeoutMs: options?.caseTimeoutMs,
      onResult: options?.onResult,
    });
  } finally {
    if (fixture.dispose) await fixture.dispose();
  }
};

export { type StateAdapterConformanceContext } from "./state-adapter-cases.js";
