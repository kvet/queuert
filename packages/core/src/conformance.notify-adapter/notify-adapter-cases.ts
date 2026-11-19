import { notifyAdapterEndToEndGroups } from "../conformance.end-to-end/groups.ts";
import { type ConformanceTestCase, toConformanceTestCases } from "../conformance/suite.ts";
import { notifyAdapterBaseGroups } from "./groups.ts";
import type { NotifyAdapterConformanceContext } from "./types.ts";

/**
 * Prepares the notify adapter conformance cases, ready to run. Each case creates its own adapter
 * with `createNotifyAdapter` and closes it when the case ends, and runs in the adapter's mode: over
 * a sync adapter (`sync: true`) every call must return a plain value and throw rather than reject,
 * and the cases wait only for delivery. Works with any test runner.
 *
 * @param options - Suite configuration.
 *
 * @example
 * ```ts
 * import { test } from "bun:test";
 *
 * const cases = createNotifyAdapterConformanceCases({
 *   createNotifyAdapter: async () => createMyNotifyAdapter({ url: process.env.BROKER_URL }),
 * });
 *
 * for (const conformanceCase of cases) {
 *   test(conformanceCase.title, async () => {
 *     await conformanceCase.run();
 *   });
 * }
 * ```
 */
export const createNotifyAdapterConformanceCases = (
  options: NotifyAdapterConformanceContext,
): ConformanceTestCase[] => toConformanceTestCases(notifyAdapterBaseGroups, options);

/**
 * Prepares the end-to-end conformance cases, ready to run: each builds a client and worker runners
 * over the notify adapter and an in-process state adapter of its mode.
 *
 * @param options - Suite configuration.
 */
export const createNotifyAdapterEndToEndConformanceCases = (
  options: NotifyAdapterConformanceContext,
): ConformanceTestCase[] => toConformanceTestCases(notifyAdapterEndToEndGroups, options);
