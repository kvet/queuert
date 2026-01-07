import { Pool } from "pg";
import type { NotifyAdapter } from "queuert";
import { createFlakyBatchGenerator } from "queuert/testing";
import { type TestAPI } from "vitest";
import { createPgNotifyAdapter } from "../notify-adapter/notify-adapter.pg.js";
import { createPgPoolNotifyProvider } from "./notify-provider.pg-pool.js";

export const extendWithPostgresNotify = <
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
        const pool = new Pool({ connectionString: postgresConnectionString });

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
          notifyJobSequenceCompleted: async (sequenceId) => {
            maybeThrow();
            return notifyAdapter.notifyJobSequenceCompleted(sequenceId);
          },
          listenJobSequenceCompleted: async (sequenceId, onNotification) => {
            maybeThrow();
            return notifyAdapter.listenJobSequenceCompleted(sequenceId, onNotification);
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
  }) as ReturnType<typeof extendWithPostgresNotify<T>>;
};
