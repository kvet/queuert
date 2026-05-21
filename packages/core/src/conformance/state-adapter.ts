import { type ConformanceReport, type ConformanceResult, runConformance } from "./runner.js";
import {
  type StateConformanceFixture,
  stateAdapterConformanceGroups,
} from "./state-adapter-cases.js";

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
  const { reset, dispose, ...context } = await factory();
  try {
    return await runConformance(stateAdapterConformanceGroups, {
      setup: async () => {
        if (reset) await reset();
        return { context };
      },
      caseTimeoutMs: options?.caseTimeoutMs,
      onResult: options?.onResult,
    });
  } finally {
    if (dispose) await dispose();
  }
};

export { type StateConformanceFixture } from "./state-adapter-cases.js";
