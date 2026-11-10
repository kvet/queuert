import {
  stateAdapterBaseGroups,
  stateAdapterConcurrentTransactionGroups,
  type StateAdapterConformanceContext,
} from "./state-adapter-cases.ts";
import { type ConformanceTestCase, toConformanceTestCases } from "./suite.ts";

/**
 * The state adapter conformance cases every adapter must pass, to run one per test in your own
 * test file. An adapter that runs transactions in parallel, such as one over a connection pool,
 * also runs {@link concurrentStateAdapterConformanceCases}.
 * Each case creates its own adapter with the context's `createStateAdapter` and closes it when
 * the case ends. Works with any test runner.
 *
 * @example
 * ```ts
 * import { afterAll, test } from "vitest";
 *
 * const db = openMyDatabase();
 * afterAll(async () => db.close());
 *
 * const context: StateAdapterConformanceContext = {
 *   createStateAdapter: async () => {
 *     const adapter = createMyStateAdapter({ db });
 *     await adapter.migrateToLatest();
 *     await clearTables(db);
 *     return adapter;
 *   },
 *   withNonTransactionContext: async (fn) => fn({ db }),
 * };
 *
 * for (const conformanceCase of stateAdapterConformanceCases) {
 *   test(conformanceCase.title, async () => {
 *     await conformanceCase.run(context);
 *   });
 * }
 * ```
 */
export const stateAdapterConformanceCases: ConformanceTestCase<StateAdapterConformanceContext>[] =
  toConformanceTestCases(stateAdapterBaseGroups);

/**
 * The state adapter conformance cases that hold two transactions open at once: blocker races,
 * concurrent deletes, row locks, and reads that must not see uncommitted rows. For adapters that
 * run transactions in parallel; run them next to {@link stateAdapterConformanceCases}.
 */
export const concurrentStateAdapterConformanceCases: ConformanceTestCase<StateAdapterConformanceContext>[] =
  toConformanceTestCases(stateAdapterConcurrentTransactionGroups);
