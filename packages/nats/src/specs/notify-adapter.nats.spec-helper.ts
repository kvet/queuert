import type { NatsConnectionOptions } from "@queuert/testcontainers";
import { connect } from "nats";
import type { NotifyAdapter } from "queuert";
import { createFlakyBatchGenerator } from "queuert/testing";
import { type TestAPI } from "vitest";
import { createNatsNotifyAdapter } from "../notify-adapter/notify-adapter.nats.js";

export const extendWithNatsNotify = <
  T extends {
    natsConnectionOptions: NatsConnectionOptions;
  },
>(
  api: TestAPI<T>,
): TestAPI<T & { notifyAdapter: NotifyAdapter; flakyNotifyAdapter: NotifyAdapter }> => {
  return api.extend<{
    notifyAdapter: NotifyAdapter;
    flakyNotifyAdapter: NotifyAdapter;
  }>({
    notifyAdapter: [
      async ({ natsConnectionOptions }, use) => {
        const nc = await connect(natsConnectionOptions);

        const js = nc.jetstream();
        const kv = await js.views.kv(
          `queuert_hints_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          { ttl: 60_000 },
        );

        const notifyAdapter = await createNatsNotifyAdapter({
          nc,
          kv,
          subjectPrefix: `queuert.${Date.now()}.${Math.random().toString(36).slice(2)}`,
        });

        await use(notifyAdapter);

        await nc.close();
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

        if (totalCalls > 5) {
          expect(errorCalls).toBeGreaterThan(0);
        }
      },
      { scope: "test" },
    ],
  }) as ReturnType<typeof extendWithNatsNotify<T>>;
};
