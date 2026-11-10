import { randomUUID } from "node:crypto";

import type { ConformanceTestCase, NotifyAdapterConformanceContext } from "queuert/conformance";
import {
  type ConformanceGroup,
  notifyAdapterBaseGroups,
  toConformanceTestCases,
} from "queuert/conformance-internal";

import { createPgNotifyAdapter } from "../notify-adapter/notify-adapter.pg.ts";
import type { PgNotifyProvider } from "../notify-provider/notify-provider.pg.ts";

/** What {@link createPgNotifyProviderConformanceContext} takes. */
export type PgNotifyProviderConformanceContextOptions = {
  /**
   * Creates the provider under test. Each case's adapter gets its own provider and closes it when
   * the case ends, so closing one must not release resources the next one needs, such as the
   * client connections.
   */
  createNotifyProvider: () => Promise<PgNotifyProvider>;
};

export const pgNotifyProviderConformanceGroups: ConformanceGroup<NotifyAdapterConformanceContext>[] =
  notifyAdapterBaseGroups;

/**
 * Prepares the context the {@link pgNotifyProviderConformanceCases} run against: each case gets its
 * own notify adapter over a new provider, on channels of its own. The test file still owns the
 * provider's resources and releases them itself.
 */
export const createPgNotifyProviderConformanceContext = ({
  createNotifyProvider,
}: PgNotifyProviderConformanceContextOptions): NotifyAdapterConformanceContext => ({
  // A channel prefix per adapter keeps one case's notifications away from the next.
  createNotifyAdapter: async () =>
    createPgNotifyAdapter({
      notifyProvider: await createNotifyProvider(),
      channelPrefix: `queuert_conformance_${randomUUID().slice(0, 8)}`,
    }),
});

/**
 * Every notify adapter case, run through `createPgNotifyAdapter` over a provider. Run them one per
 * test in your own test file against a context from {@link
 * createPgNotifyProviderConformanceContext}. Works with any test runner.
 *
 * @example
 * ```ts
 * import { afterAll, test } from "vitest";
 *
 * const pool = new Pool({ connectionString });
 * const context = createPgNotifyProviderConformanceContext({
 *   createNotifyProvider: async () => createPgPoolNotifyProvider({ pool }),
 * });
 * afterAll(async () => pool.end());
 *
 * for (const conformanceCase of pgNotifyProviderConformanceCases) {
 *   test(conformanceCase.title, async () => {
 *     await conformanceCase.run(context);
 *   });
 * }
 * ```
 */
export const pgNotifyProviderConformanceCases: ConformanceTestCase<NotifyAdapterConformanceContext>[] =
  toConformanceTestCases(pgNotifyProviderConformanceGroups);
