import { notifyAdapterEndToEndGroups } from "../conformance.end-to-end/groups.ts";
import { type ConformanceTestCase, toConformanceTestCases } from "../conformance/suite.ts";
import { notifyAdapterBaseGroups } from "./groups.ts";
import type { NotifyAdapterConformanceContext } from "./types.ts";

/**
 * The notify adapter conformance cases, to run one per test in your own test file.
 * Each case creates its own adapter with the context's `createNotifyAdapter` and closes it when
 * the case ends. Works with any test runner.
 *
 * @example
 * ```ts
 * import { test } from "bun:test";
 *
 * const context: NotifyAdapterConformanceContext = {
 *   createNotifyAdapter: async () => createMyNotifyAdapter({ url: process.env.BROKER_URL }),
 * };
 *
 * for (const conformanceCase of notifyAdapterConformanceCases) {
 *   test(conformanceCase.title, async () => {
 *     await conformanceCase.run(context);
 *   });
 * }
 * ```
 */
export const notifyAdapterConformanceCases: ConformanceTestCase<NotifyAdapterConformanceContext>[] =
  toConformanceTestCases(notifyAdapterBaseGroups, "async");

/**
 * The notify adapter conformance cases for a {@link SyncNotifyAdapter}. The cases call the adapter
 * synchronously, fail when a call returns a promise, and wait only for delivery.
 */
export const syncNotifyAdapterConformanceCases: ConformanceTestCase<NotifyAdapterConformanceContext>[] =
  toConformanceTestCases(notifyAdapterBaseGroups, "sync");

/** End-to-end cases that build a client and worker runners over the adapter and in-memory state. */
export const notifyAdapterEndToEndConformanceCases: ConformanceTestCase<NotifyAdapterConformanceContext>[] =
  toConformanceTestCases(notifyAdapterEndToEndGroups, "async");

/**
 * End-to-end cases for a {@link SyncNotifyAdapter}: they build a client over the sync in-process
 * state adapter and the adapter under test.
 */
export const syncNotifyAdapterEndToEndConformanceCases: ConformanceTestCase<NotifyAdapterConformanceContext>[] =
  toConformanceTestCases(notifyAdapterEndToEndGroups, "sync");
