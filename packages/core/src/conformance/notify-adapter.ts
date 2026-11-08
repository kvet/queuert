import { type NotifyConformanceFixture, notifyAdapterBaseGroups } from "./notify-adapter-cases.ts";
import {
  type ConformanceOptions,
  type ConformanceReport,
  runFixtureConformance,
} from "./runner.ts";

/**
 * Run the notify adapter conformance suite against a user-supplied adapter.
 * Test-framework agnostic: designed to be embedded in a single test
 * (vitest `test()`, bun `test()`, `node:test`, etc.). Throws
 * {@link ConformanceError} with an aggregated report on any failure.
 *
 * @example
 * ```ts
 * await runNotifyAdapterConformance(async () => {
 *   const notifyAdapter = await createMyNotifyAdapter();
 *   return {
 *     notifyAdapter,
 *     dispose: async () => notifyAdapter.close(),
 *   };
 * });
 * ```
 */
export const runNotifyAdapterConformance = async (
  factory: () => Promise<NotifyConformanceFixture>,
  options?: ConformanceOptions,
): Promise<ConformanceReport> => runFixtureConformance(notifyAdapterBaseGroups, factory, options);
