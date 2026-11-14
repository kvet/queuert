import {
  endToEndAsyncGroups,
  endToEndBaseGroups,
  endToEndConcurrentTransactionGroups,
  endToEndNotifyGroups,
} from "../conformance.end-to-end/groups.ts";
import { type ConformanceTestCase, toConformanceTestCases } from "../conformance/suite.ts";
import {
  stateAdapterAsyncGroups,
  stateAdapterBaseGroups,
  stateAdapterConcurrentTransactionGroups,
} from "./groups.ts";
import type { StateAdapterConformanceContext } from "./types.ts";

/**
 * The state adapter conformance cases every adapter must pass, to run one per test in your own
 * test file. An async adapter also runs {@link asyncStateAdapterConformanceCases}, and an adapter
 * that runs transactions in parallel, such as one over a connection pool, also runs
 * {@link concurrentStateAdapterConformanceCases}.
 * Each case creates its own adapter with the context's `createStateAdapter` and closes it when
 * the case ends, and runs in the adapter's mode: over a sync adapter (`sync: true`) every call
 * must return a plain value and throw rather than reject, and over an async one it must return a
 * promise. Works with any test runner.
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
 * The state adapter conformance cases that hold a transaction open across an `await`, which only
 * an async adapter can do. An async adapter runs them next to
 * {@link stateAdapterConformanceCases}.
 */
export const asyncStateAdapterConformanceCases: ConformanceTestCase<StateAdapterConformanceContext>[] =
  toConformanceTestCases(stateAdapterAsyncGroups);

/**
 * The state adapter conformance cases that hold two transactions open at once: blocker races,
 * concurrent deletes, row locks, and reads that must not see uncommitted rows. For adapters that
 * run transactions in parallel; run them next to {@link stateAdapterConformanceCases}.
 */
export const concurrentStateAdapterConformanceCases: ConformanceTestCase<StateAdapterConformanceContext>[] =
  toConformanceTestCases(stateAdapterConcurrentTransactionGroups);

/**
 * End-to-end cases that build a client and worker runners over the adapter under test, in its
 * mode. An async adapter also runs {@link asyncStateAdapterEndToEndConformanceCases}.
 */
export const stateAdapterEndToEndConformanceCases: ConformanceTestCase<StateAdapterConformanceContext>[] =
  toConformanceTestCases([...endToEndBaseGroups, ...endToEndNotifyGroups]);

/**
 * End-to-end cases that hold a transaction open across an `await`, which only an async adapter can
 * do. An async adapter runs them next to {@link stateAdapterEndToEndConformanceCases}.
 */
export const asyncStateAdapterEndToEndConformanceCases: ConformanceTestCase<StateAdapterConformanceContext>[] =
  toConformanceTestCases(endToEndAsyncGroups);

/** End-to-end cases that need transactions running in parallel, for adapters that support it. */
export const concurrentStateAdapterEndToEndConformanceCases: ConformanceTestCase<StateAdapterConformanceContext>[] =
  toConformanceTestCases(endToEndConcurrentTransactionGroups);
