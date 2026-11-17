import { randomUUID } from "node:crypto";

import type { ConformanceTestCase, NotifyAdapterConformanceContext } from "queuert/conformance";
import {
  type ConformanceGroup,
  notifyAdapterBaseGroups,
  toConformanceTestCases,
} from "queuert/conformance-internal";

import { createRedisNotifyAdapter } from "../notify-adapter/notify-adapter.redis.ts";
import type { RedisNotifyProvider } from "../notify-provider/notify-provider.redis.ts";

export const redisNotifyProviderConformanceGroups: ConformanceGroup<NotifyAdapterConformanceContext>[] =
  notifyAdapterBaseGroups;

/**
 * Prepares every notify adapter contract case, run through `createRedisNotifyAdapter` over a
 * provider, and the context they run against: a notify adapter per case over a new provider, on
 * channels of its own. The test file still owns the provider's resources and releases them itself.
 * Works with any test runner.
 *
 * @param options - Context configuration.
 *
 * @example
 * ```ts
 * import { afterAll, test } from "vitest";
 *
 * const client = new Redis(url);
 * const subscribeClient = new Redis(url);
 * const { context, cases } = createRedisNotifyProviderConformanceContext({
 *   createNotifyProvider: async () => createIoredisNotifyProvider({ client, subscribeClient }),
 * });
 * afterAll(async () => {
 *   await client.quit();
 *   await subscribeClient.quit();
 * });
 *
 * for (const conformanceCase of cases) {
 *   test(conformanceCase.title, async () => {
 *     await conformanceCase.run(context);
 *   });
 * }
 * ```
 */
export const createRedisNotifyProviderConformanceContext = ({
  createNotifyProvider,
}: {
  /**
   * Creates the provider under test. Each case's adapter gets its own provider and closes it when
   * the case ends, so closing one must not release resources the next one needs, such as the
   * client connections.
   */
  createNotifyProvider: () => Promise<RedisNotifyProvider>;
}): {
  context: NotifyAdapterConformanceContext;
  cases: ConformanceTestCase<NotifyAdapterConformanceContext>[];
} => ({
  context: {
    // A channel prefix per adapter keeps one case's notifications away from the next.
    createNotifyAdapter: async () =>
      createRedisNotifyAdapter({
        notifyProvider: await createNotifyProvider(),
        channelPrefix: `queuert:conformance:${randomUUID()}`,
      }),
  },
  cases: toConformanceTestCases(redisNotifyProviderConformanceGroups),
});
