import { randomUUID } from "node:crypto";

import type { ConformanceTestCase } from "queuert/conformance";
import {
  type ConformanceGroup,
  notifyAdapterBaseGroups,
  toConformanceTestCases,
  type NotifyAdapterConformanceContext,
} from "queuert/conformance-internal";

import { createPgNotifyAdapter } from "../notify-adapter/notify-adapter.pg.ts";
import type { PgNotifyProvider } from "../notify-provider/notify-provider.pg.ts";

export const pgNotifyProviderConformanceGroups: ConformanceGroup<NotifyAdapterConformanceContext>[] =
  notifyAdapterBaseGroups;

export const createPgNotifyProviderConformanceContext = ({
  createNotifyProvider,
}: Parameters<
  typeof createPgNotifyProviderConformanceCases
>[0]): NotifyAdapterConformanceContext => ({
  // A channel prefix per adapter keeps one case's notifications away from the next.
  createNotifyAdapter: async () =>
    createPgNotifyAdapter({
      notifyProvider: await createNotifyProvider(),
      channelPrefix: `queuert_conformance_${randomUUID().slice(0, 8)}`,
    }),
});

/**
 * Prepares every notify adapter contract case, run through `createPgNotifyAdapter` over a provider,
 * ready to run: each case gets its own notify adapter over a new provider, on channels of its own.
 * The test file still owns the provider's resources and releases them itself. Works with any test
 * runner.
 *
 * @param options - Suite configuration.
 *
 * @example
 * ```ts
 * import { afterAll, test } from "vitest";
 *
 * const pool = new Pool({ connectionString });
 * const cases = createPgNotifyProviderConformanceCases({
 *   createNotifyProvider: async () => createPgPoolNotifyProvider({ pool }),
 * });
 * afterAll(async () => pool.end());
 *
 * for (const conformanceCase of cases) {
 *   test(conformanceCase.title, async () => {
 *     await conformanceCase.run();
 *   });
 * }
 * ```
 */
export const createPgNotifyProviderConformanceCases = (options: {
  /**
   * Creates the provider under test. Each case's adapter gets its own provider and closes it when
   * the case ends, so closing one must not release resources the next one needs, such as the
   * client connections.
   */
  createNotifyProvider: () => Promise<PgNotifyProvider>;
}): ConformanceTestCase[] =>
  toConformanceTestCases(
    pgNotifyProviderConformanceGroups,
    createPgNotifyProviderConformanceContext(options),
  );
