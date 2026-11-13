import {
  endToEndBaseGroups,
  endToEndConcurrentTransactionGroups,
  endToEndNotifyGroups,
} from "../conformance.end-to-end/groups.ts";
import { type ConformanceTestCase, toConformanceTestCases } from "../conformance/suite.ts";
import { stateAdapterBaseGroups, stateAdapterConcurrentTransactionGroups } from "./groups.ts";
import type { StateAdapterConformanceContext } from "./types.ts";

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
  toConformanceTestCases(stateAdapterBaseGroups, "async");

/**
 * The state adapter conformance cases for a {@link SyncStateAdapter}: the cases of
 * {@link stateAdapterConformanceCases}, without those that hold a transaction open across an
 * `await`. The context creates sync adapters, whose calls must return plain values and throw
 * rather than reject.
 */
export const syncStateAdapterConformanceCases: ConformanceTestCase<StateAdapterConformanceContext>[] =
  toConformanceTestCases(stateAdapterBaseGroups, "sync");

/**
 * The state adapter conformance cases that hold two transactions open at once: blocker races,
 * concurrent deletes, row locks, and reads that must not see uncommitted rows. For adapters that
 * run transactions in parallel; run them next to {@link stateAdapterConformanceCases}.
 */
export const concurrentStateAdapterConformanceCases: ConformanceTestCase<StateAdapterConformanceContext>[] =
  toConformanceTestCases(stateAdapterConcurrentTransactionGroups);

/** End-to-end cases that build a client and worker runners over the adapter under test. */
export const stateAdapterEndToEndConformanceCases: ConformanceTestCase<StateAdapterConformanceContext>[] =
  toConformanceTestCases([...endToEndBaseGroups, ...endToEndNotifyGroups], "async");

/**
 * End-to-end cases that build a client and worker runners over a {@link SyncStateAdapter}; the
 * cases that hold a transaction open across an `await` are left out.
 */
export const syncStateAdapterEndToEndConformanceCases: ConformanceTestCase<StateAdapterConformanceContext>[] =
  toConformanceTestCases([...endToEndBaseGroups, ...endToEndNotifyGroups], "sync");

/** End-to-end cases that need transactions running in parallel, for adapters that support it. */
export const concurrentStateAdapterEndToEndConformanceCases: ConformanceTestCase<StateAdapterConformanceContext>[] =
  toConformanceTestCases(endToEndConcurrentTransactionGroups);
