import { Pool } from "pg";
import type { NotifyAdapter } from "queuert";
import { createFlakyBatchGenerator } from "queuert/testing";
import { type TestAPI } from "vitest";
import { createPgNotifyAdapter } from "../notify-adapter/notify-adapter.pg.js";
import { createPgPoolNotifyProvider } from "./notify-provider.pg-pool.js";

export const extendWithNotifyPostgres = <
  T extends {
    postgresConnectionString: string;
  },
>(
  api: TestAPI<T>,
): TestAPI<T & { notifyAdapter: NotifyAdapter; flakyNotifyAdapter: NotifyAdapter }> => {
  return api.extend<{
    notifyAdapter: NotifyAdapter;
    flakyNotifyAdapter: NotifyAdapter;
  }>({
    notifyAdapter: [
      async ({ postgresConnectionString }, use) => {
        const pool = new Pool({
          connectionString: postgresConnectionString,
          allowExitOnIdle: true, // Unref idle timeout timers to prevent resource leak detection
        });

        const provider = createPgPoolNotifyProvider({ pool });
        const notifyAdapter = await createPgNotifyAdapter({
          provider,
          channelPrefix: `queuert_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        });

        await use(notifyAdapter);

        await pool.end();
      },
      { scope: "test" },
    ],
    flakyNotifyAdapter: [
      async ({ notifyAdapter, expect }, use) => {
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
          notifyJobScheduled: async (typeName, count) => {
            maybeThrow();
            return notifyAdapter.notifyJobScheduled(typeName, count);
          },
          listenJobScheduled: async (typeNames, onNotification) => {
            maybeThrow();
            return notifyAdapter.listenJobScheduled(typeNames, onNotification);
          },
          notifyJobChainCompleted: async (chainId) => {
            maybeThrow();
            return notifyAdapter.notifyJobChainCompleted(chainId);
          },
          listenJobChainCompleted: async (chainId, onNotification) => {
            maybeThrow();
            return notifyAdapter.listenJobChainCompleted(chainId, onNotification);
          },
          notifyJobOwnershipLost: async (jobId) => {
            maybeThrow();
            return notifyAdapter.notifyJobOwnershipLost(jobId);
          },
          listenJobOwnershipLost: async (jobId, onNotification) => {
            maybeThrow();
            return notifyAdapter.listenJobOwnershipLost(jobId, onNotification);
          },
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
