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

import { createRedisNotifyAdapter } from "../notify-adapter/notify-adapter.redis.ts";
import type { RedisNotifyProvider } from "../notify-provider/notify-provider.redis.ts";

/** Fixture for {@link runRedisNotifyProviderConformance}. */
export type RedisNotifyProviderConformanceFixture = {
  /** The provider under test. */
  notifyProvider: RedisNotifyProvider;
  /** Called once after all cases finish (pass or fail) to release resources. */
  dispose?: () => Promise<void>;
};

export const redisNotifyProviderConformanceGroups: ConformanceGroup<NotifyConformanceFixture>[] =
  notifyAdapterBaseGroups;

export const createRedisNotifyConformanceContext = ({
  notifyProvider,
  dispose,
}: RedisNotifyProviderConformanceFixture): NotifyConformanceFixture & {
  dispose?: () => Promise<void>;
} => ({
  notifyAdapter: createRedisNotifyAdapter({
    notifyProvider,
    channelPrefix: `queuert:conformance:${randomUUID()}`,
  }),
  dispose,
});

/**
 * Run the conformance suite against a {@link RedisNotifyProvider}: every notify adapter case, run
 * through `createRedisNotifyAdapter` over the provider. Test-framework agnostic: designed to be
 * embedded in a single test. Throws `ConformanceError` with an aggregated report on any failure.
 *
 * @example
 * ```ts
 * await runRedisNotifyProviderConformance(async () => {
 *   const client = new Redis(url);
 *   const subscribeClient = new Redis(url);
 *   return {
 *     notifyProvider: createIoredisNotifyProvider({ client, subscribeClient }),
 *     dispose: async () => {
 *       await client.quit();
 *       await subscribeClient.quit();
 *     },
 *   };
 * });
 * ```
 */
export const runRedisNotifyProviderConformance = async (
  factory: () => Promise<RedisNotifyProviderConformanceFixture>,
  options?: ConformanceOptions,
): Promise<ConformanceReport> => {
  const fixture = await factory();
  return runFixtureConformance(
    redisNotifyProviderConformanceGroups,
    async () => createRedisNotifyConformanceContext(fixture),
    options,
  );
};
