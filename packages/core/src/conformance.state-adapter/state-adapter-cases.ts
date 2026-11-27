import {
  endToEndAsyncGroups,
  endToEndBaseGroups,
  endToEndConcurrentTransactionGroups,
  endToEndConcurrentTransactionLockWaitGroups,
  endToEndNotifyConcurrentTransactionGroups,
  endToEndNotifyGroups,
} from "../conformance.end-to-end/groups.ts";
import { type ConformanceTestCase, toConformanceTestCases } from "../conformance/suite.ts";
import {
  stateAdapterAsyncGroups,
  stateAdapterAsyncLockWaitGroups,
  stateAdapterBaseGroups,
  stateAdapterConcurrentTransactionGroups,
  stateAdapterConcurrentTransactionTwoConnectionGroups,
  stateAdapterConcurrentTransactionLockWaitGroups,
} from "./groups.ts";
import type { StateAdapterConformanceContext } from "./types.ts";

type StateAdapterConformanceOptions = StateAdapterConformanceContext & {
  /**
   * The adapter's mode: `"sync"` for an adapter with `sync: true`, `"async"` otherwise. In
   * `"async"` the cases also include those that hold a transaction open across an `await`.
   */
  mode: "sync" | "async";
  /**
   * Whether the adapter runs transactions in parallel, such as one over a connection pool. When
   * `true` the cases also include those that hold two transactions open at once.
   */
  concurrent?: boolean;
};

/**
 * Prepares the state adapter conformance cases every adapter must pass, ready to run: in `"async"`
 * mode also the cases that hold a transaction open across an `await`, and with `concurrent: true`
 * those that hold two transactions open at once (blocker races, concurrent deletes, row locks, and
 * reads that must not see uncommitted rows). Each case creates its own adapter with
 * `createStateAdapter` and closes it when the case ends, and runs in the adapter's mode: over a
 * sync adapter every call must return a plain value and throw rather than reject, and over an async
 * one it must return a promise. Works with any test runner.
 *
 * @param options - Suite configuration.
 *
 * @example
 * ```ts
 * import { afterAll, test } from "vitest";
 *
 * const db = openMyDatabase();
 * afterAll(async () => db.close());
 *
 * const cases = createStateAdapterConformanceCases({
 *   mode: "async",
 *   createStateAdapter: async () => {
 *     const adapter = createMyStateAdapter({ db });
 *     await adapter.migrateToLatest();
 *     await clearTables(db);
 *     return adapter;
 *   },
 *   withNonTransactionContext: async (fn) => fn({ db }),
 * });
 *
 * for (const conformanceCase of cases) {
 *   test(conformanceCase.title, async () => {
 *     await conformanceCase.run();
 *   });
 * }
 * ```
 */
export const createStateAdapterConformanceCases = ({
  mode,
  concurrent,
  ...context
}: StateAdapterConformanceOptions): ConformanceTestCase[] =>
  toConformanceTestCases(
    [
      ...stateAdapterBaseGroups,
      ...(mode === "async" ? [...stateAdapterAsyncGroups, ...stateAdapterAsyncLockWaitGroups] : []),
      ...(concurrent === true
        ? [
            ...stateAdapterConcurrentTransactionGroups,
            ...stateAdapterConcurrentTransactionTwoConnectionGroups,
            ...stateAdapterConcurrentTransactionLockWaitGroups,
          ]
        : []),
    ],
    context,
  );

/**
 * Prepares the end-to-end conformance cases, ready to run: each builds a client and worker runners
 * over the adapter under test, in its mode, and over the notify adapter from `createNotifyAdapter`
 * or an in-process one. Takes the same options as {@link createStateAdapterConformanceCases}, which
 * add the end-to-end cases that need an async adapter or parallel transactions.
 *
 * @param options - Suite configuration.
 */
export const createStateAdapterEndToEndConformanceCases = ({
  mode,
  concurrent,
  ...context
}: StateAdapterConformanceOptions): ConformanceTestCase[] =>
  toConformanceTestCases(
    [
      ...endToEndBaseGroups,
      ...endToEndNotifyGroups,
      ...(mode === "async" ? endToEndAsyncGroups : []),
      ...(concurrent === true
        ? [
            ...endToEndConcurrentTransactionGroups,
            ...endToEndConcurrentTransactionLockWaitGroups,
            ...endToEndNotifyConcurrentTransactionGroups,
          ]
        : []),
    ],
    context,
  );
