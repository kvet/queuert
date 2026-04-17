import { type NotifyAdapter } from "../notify-adapter/notify-adapter.js";
import {
  type NotifyAdapterConformanceContext,
  notifyAdapterConformanceGroups,
} from "./notify-adapter-cases.js";
import { type ConformanceReport, type ConformanceResult, runConformance } from "./runner.js";

/**
 * Fixture returned by the factory passed to {@link runNotifyAdapterConformance}.
 *
 * - **notifyAdapter** — the adapter under test.
 * - **reset** — optional. Called before each conformance case.
 * - **dispose** — optional. Called once after all cases finish (pass or fail)
 *   to release resources (close connections, stop containers).
 */
export type NotifyConformanceFixture = {
  notifyAdapter: NotifyAdapter;
  reset?: () => Promise<void>;
  dispose?: () => Promise<void>;
};

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
  const fixture = await factory();
  try {
    return await runConformance(notifyAdapterConformanceGroups, {
      setup: async () => {
        if (fixture.reset) await fixture.reset();
        return {
          context: {
            notifyAdapter: fixture.notifyAdapter,
          } satisfies NotifyAdapterConformanceContext,
        };
      },
      caseTimeoutMs: options?.caseTimeoutMs,
      onResult: options?.onResult,
    });
  } finally {
    if (fixture.dispose) await fixture.dispose();
  }
};

export { type NotifyAdapterConformanceContext } from "./notify-adapter-cases.js";
