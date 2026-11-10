import { connect, type NatsConnection } from "@nats-io/transport-node";
import { createNatsNotifyAdapter } from "@queuert/nats";
import { acquireNats, type AcquiredNats } from "@queuert/testcontainers";
import {
  type NotifyAdapterConformanceContext,
  notifyAdapterConformanceCases,
} from "queuert/conformance";
import { afterAll, beforeAll, describe, test } from "vitest";

// #region conformance
describe("notify-nats-transport-node adapter conformance", () => {
  let nats: AcquiredNats;
  let nc: NatsConnection;
  let context: NotifyAdapterConformanceContext;

  beforeAll(async () => {
    nats = await acquireNats("nats:2");
    nc = await connect(nats.connectionOptions);
    context = {
      createNotifyAdapter: async () =>
        createNatsNotifyAdapter({
          nc,
          subjectPrefix: `queuert.spec.${Date.now()}.${Math.random().toString(36).slice(2)}`,
        }),
    };
  }, 60_000);

  afterAll(async () => {
    await nc.close();
    await nats[Symbol.asyncDispose]();
  });

  for (const conformanceCase of notifyAdapterConformanceCases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
// #endregion
