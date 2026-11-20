import { randomUUID } from "node:crypto";

import type { ConformanceTestCase } from "queuert/conformance";
import {
  type ConformanceGroup,
  notifyAdapterBaseGroups,
  toConformanceTestCases,
  type NotifyAdapterConformanceContext,
} from "queuert/conformance-internal";

import { createRedisNotifyAdapter } from "../notify-adapter/notify-adapter.redis.ts";
import type { RedisNotifyProvider } from "../notify-provider/notify-provider.redis.ts";

export const redisNotifyProviderConformanceGroups: ConformanceGroup<NotifyAdapterConformanceContext>[] =
  notifyAdapterBaseGroups;

export const createRedisNotifyProviderConformanceContext = ({
  createNotifyProvider,
}: Parameters<
  typeof createRedisNotifyProviderConformanceCases
>[0]): NotifyAdapterConformanceContext => ({
  mode: "async",
  // A channel prefix per adapter keeps one case's notifications away from the next.
  createNotifyAdapter: async () =>
    createRedisNotifyAdapter({
      notifyProvider: await createNotifyProvider(),
      channelPrefix: `queuert:conformance:${randomUUID()}`,
    }),
});

/**
 * Prepares every notify adapter contract case, run through `createRedisNotifyAdapter` over a
 * provider, ready to run: a notify adapter per case over a new provider, on channels of its own.
 * The test file still owns the provider's resources and releases them itself. Works with any test
 * runner.
 *
 * @param options - Suite configuration.
 *
 * @example
 * ```ts
 * import { afterAll, test } from "vitest";
 *
 * const client = new Redis(url);
 * const subscribeClient = new Redis(url);
 * const cases = createRedisNotifyProviderConformanceCases({
 *   createNotifyProvider: async () => createIoredisNotifyProvider({ client, subscribeClient }),
 * });
 * afterAll(async () => {
 *   await client.quit();
 *   await subscribeClient.quit();
 * });
 *
 * for (const conformanceCase of cases) {
 *   test(conformanceCase.title, async () => {
 *     await conformanceCase.run();
 *   });
 * }
 * ```
 */
export const createRedisNotifyProviderConformanceCases = (options: {
  /**
   * Creates the provider under test. Each case's adapter gets its own provider and closes it when
   * the case ends, so closing one must not release resources the next one needs, such as the
   * client connections.
   */
  createNotifyProvider: () => Promise<RedisNotifyProvider>;
}): ConformanceTestCase[] =>
  toConformanceTestCases(
    redisNotifyProviderConformanceGroups,
    createRedisNotifyProviderConformanceContext(options),
  );
