import { randomUUID } from "node:crypto";

import type {
  ConformanceOptions,
  ConformanceReport,
  NotifyConformanceFixture,
} from "queuert/conformance";
import {
  type ConformanceGroup,
  notifyAdapterBaseGroups,
  runFixtureConformance,
} from "queuert/conformance-internal";

import { createPgNotifyAdapter } from "../notify-adapter/notify-adapter.pg.ts";
import type { PgNotifyProvider } from "../notify-provider/notify-provider.pg.ts";

/** Fixture for {@link runPgNotifyProviderConformance}. */
export type PgNotifyProviderConformanceFixture = {
  /** The provider under test. */
  notifyProvider: PgNotifyProvider;
  /** Called once after all cases finish (pass or fail) to release resources. */
  dispose?: () => Promise<void>;
};

export const pgNotifyProviderConformanceGroups: ConformanceGroup<NotifyConformanceFixture>[] =
  notifyAdapterBaseGroups;

export const createPgNotifyConformanceContext = ({
  notifyProvider,
  dispose,
}: PgNotifyProviderConformanceFixture): NotifyConformanceFixture & {
  dispose?: () => Promise<void>;
} => ({
  notifyAdapter: createPgNotifyAdapter({
    notifyProvider,
    channelPrefix: `queuert_conformance_${randomUUID().slice(0, 8)}`,
  }),
  dispose,
});

/**
 * Run the conformance suite against a {@link PgNotifyProvider}: every notify adapter case, run
 * through `createPgNotifyAdapter` over the provider. Test-framework agnostic: designed to be
 * embedded in a single test. Throws `ConformanceError` with an aggregated report on any failure.
 *
 * @example
 * ```ts
 * await runPgNotifyProviderConformance(async () => {
 *   const pool = new Pool({ connectionString });
 *   return {
 *     notifyProvider: createPgPoolNotifyProvider({ pool }),
 *     dispose: async () => pool.end(),
 *   };
 * });
 * ```
 */
export const runPgNotifyProviderConformance = async (
  factory: () => Promise<PgNotifyProviderConformanceFixture>,
  options?: ConformanceOptions,
): Promise<ConformanceReport> => {
  const fixture = await factory();
  return runFixtureConformance(
    pgNotifyProviderConformanceGroups,
    async () => createPgNotifyConformanceContext(fixture),
    options,
  );
};
