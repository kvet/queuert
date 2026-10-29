import { type NatsConnectionOptions } from "@queuert/testcontainers";
import { connect } from "nats";
import { type NotifyAdapter } from "queuert";
import { type TestSuiteContext, createFlakyBatchGenerator } from "queuert/testing";
import { type TestAPI, expect } from "vitest";

import { createNatsNotifyAdapter } from "../notify-adapter/notify-adapter.nats.js";

export const extendWithNotifyNats = <
  T extends {
    natsConnectionOptions: NatsConnectionOptions;
  },
>(
  api: TestAPI<T>,
): TestAPI<T & Pick<TestSuiteContext, "notifyAdapter"> & { flakyNotifyAdapter: NotifyAdapter }> => {
  return api.extend<{
    notifyAdapter: NotifyAdapter;
    flakyNotifyAdapter: NotifyAdapter;
  }>({
    notifyAdapter: [
      async ({ natsConnectionOptions }, use) => {
        const nc = await connect(natsConnectionOptions);

        const notifyAdapter = await createNatsNotifyAdapter({
          nc,
          subjectPrefix: `queuert.${Date.now()}.${Math.random().toString(36).slice(2)}`,
        });

        await use(notifyAdapter);

        await nc.close();
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
          notifyJobsScheduled: async (typeNames) => {
            maybeThrow();
            return notifyAdapter.notifyJobsScheduled(typeNames);
          },
          listenJobScheduled: async (typeNames, onNotification) => {
            maybeThrow();
            return notifyAdapter.listenJobScheduled(typeNames, onNotification);
          },
          notifyChainsCompleted: async (chainIds) => {
            maybeThrow();
            return notifyAdapter.notifyChainsCompleted(chainIds);
          },
          listenChainCompleted: async (chainId, onNotification) => {
            maybeThrow();
            return notifyAdapter.listenChainCompleted(chainId, onNotification);
          },
          notifyJobAttemptsLost: async (jobIds) => {
            maybeThrow();
            return notifyAdapter.notifyJobAttemptsLost(jobIds);
          },
          listenJobAttemptLost: async (jobId, onNotification) => {
            maybeThrow();
            return notifyAdapter.listenJobAttemptLost(jobId, onNotification);
          },
          close: notifyAdapter.close,
        };

        await use(flakyNotifyAdapter);

        if (totalCalls > 5) {
          expect(errorCalls).toBeGreaterThan(0);
        }
      },
      { scope: "test" },
    ],
  }) as ReturnType<typeof extendWithNotifyNats<T>>;
};
