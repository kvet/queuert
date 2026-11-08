import {
  type ConformanceOptions,
  type ConformanceReport,
  runFixtureConformance,
} from "./runner.ts";
import {
  stateAdapterBaseGroups,
  stateAdapterConcurrentTransactionGroups,
  type StateConformanceFixture,
} from "./state-adapter-cases.ts";

/**
 * Run the state adapter conformance suite against a user-supplied adapter: the cases every
 * adapter must pass, with transactions run one at a time. Test-framework agnostic: designed to be
 * embedded in a single test (vitest `test()`, bun `test()`, `node:test`, etc.). Throws
 * {@link ConformanceError} with an aggregated report on any failure.
 *
 * An adapter that runs transactions in parallel, such as one over a connection pool, also runs
 * {@link runConcurrentStateAdapterConformance}.
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
  options?: ConformanceOptions,
): Promise<ConformanceReport> => runFixtureConformance(stateAdapterBaseGroups, factory, options);

/**
 * Run the state adapter conformance cases that hold two transactions open at once: blocker races,
 * concurrent deletes, row locks, and reads that must not see uncommitted rows. For adapters that
 * run transactions in parallel, such as one over a connection pool; run it next to
 * {@link runStateAdapterConformance}. Throws {@link ConformanceError} with an aggregated report
 * on any failure.
 *
 * @example
 * ```ts
 * await runConcurrentStateAdapterConformance(async () => {
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
export const runConcurrentStateAdapterConformance = async (
  factory: () => Promise<StateConformanceFixture>,
  options?: ConformanceOptions,
): Promise<ConformanceReport> =>
  runFixtureConformance(stateAdapterConcurrentTransactionGroups, factory, options);
