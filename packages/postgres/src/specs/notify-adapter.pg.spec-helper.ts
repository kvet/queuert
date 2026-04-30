import { Pool } from "pg";
import { type NotifyAdapter } from "queuert";
import { type TestSuiteContext, createFlakyBatchGenerator } from "queuert/testing";
import { type TestAPI, expect } from "vitest";

import { createPgNotifyAdapter } from "../notify-adapter/notify-adapter.pg.js";
import { createPgPoolNotifyProvider } from "../notify-provider/notify-provider.pg-pool.js";

export const extendWithNotifyPostgres = <
  T extends {
    postgresConnectionString: string;
  },
>(
  api: TestAPI<T>,
): TestAPI<T & Pick<TestSuiteContext, "notifyAdapter"> & { flakyNotifyAdapter: NotifyAdapter }> => {
  return api.extend<{
    notifyPool: Pool;
    notifyAdapter: NotifyAdapter;
    flakyNotifyAdapter: NotifyAdapter;
  }>({
    notifyPool: [
      async ({ postgresConnectionString }, use) => {
        const pool = new Pool({
          connectionString: postgresConnectionString,
          idleTimeoutMillis: 0,
        });

        await use(pool);

        await pool.end();
      },
      { scope: "worker" },
    ],
    notifyAdapter: [
      async ({ notifyPool }, use) => {
        const notifyProvider = createPgPoolNotifyProvider({ pool: notifyPool });
        const notifyAdapter = await createPgNotifyAdapter({
          notifyProvider,
          channelPrefix: `queuert_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        });

        await use(notifyAdapter);

        await notifyProvider.close?.();
      },
      { scope: "test" },
    ],
    flakyNotifyAdapter: [
      async ({ notifyAdapter }, use) => {
        let totalCalls = 0;
        let errorCalls = 0;
        const shouldError = createFlakyBatchGenerator();

        const maybeThrow = (): void => {
          totalCalls++;

          if (shouldError()) {
            errorCalls++;
            const error = new Error("connection reset") as Error & { code: string };
            error.code = "ECONNRESET";
            throw error;
          }
        };

        const flakyNotifyAdapter: NotifyAdapter = {
          notifyJobScheduled: async (typeName) => {
            maybeThrow();
            return notifyAdapter.notifyJobScheduled(typeName);
          },
          listenJobScheduled: async (typeNames, onNotification) => {
            maybeThrow();
            return notifyAdapter.listenJobScheduled(typeNames, onNotification);
          },
          provideWakeHint: async (typeName, count) => {
            maybeThrow();
            return notifyAdapter.provideWakeHint(typeName, count);
          },
          consumeWakeHint: async (typeName) => {
            maybeThrow();
            return notifyAdapter.consumeWakeHint(typeName);
          },
          notifyChainCompleted: async (chainId) => {
            maybeThrow();
            return notifyAdapter.notifyChainCompleted(chainId);
          },
          listenChainCompleted: async (chainId, onNotification) => {
            maybeThrow();
            return notifyAdapter.listenChainCompleted(chainId, onNotification);
          },
          notifyJobOwnershipLost: async (jobId) => {
            maybeThrow();
            return notifyAdapter.notifyJobOwnershipLost(jobId);
          },
          listenJobOwnershipLost: async (jobId, onNotification) => {
            maybeThrow();
            return notifyAdapter.listenJobOwnershipLost(jobId, onNotification);
          },
          close: notifyAdapter.close,
        };

        await use(flakyNotifyAdapter);

        // Verify that errors were actually injected if enough calls were made
        if (totalCalls > 5) {
          expect(errorCalls).toBeGreaterThan(0);
        }
      },
      { scope: "test" },
    ],
  }) as ReturnType<typeof extendWithNotifyPostgres<T>>;
};
