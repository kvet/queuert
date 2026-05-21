import {
  type NotifyConformanceFixture,
  notifyAdapterConformanceGroups,
} from "./notify-adapter-cases.js";
import { type ConformanceReport, type ConformanceResult, runConformance } from "./runner.js";

export type NotifyConformanceOptions = {
  caseTimeoutMs?: number;
  onResult?: (result: ConformanceResult) => void;
};

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
  options?: NotifyConformanceOptions,
): Promise<ConformanceReport> => {
  const { reset, dispose, ...context } = await factory();
  try {
    return await runConformance(notifyAdapterConformanceGroups, {
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

export { type NotifyConformanceFixture } from "./notify-adapter-cases.js";
