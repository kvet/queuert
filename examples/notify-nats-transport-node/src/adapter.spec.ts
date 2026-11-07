import { connect } from "@nats-io/transport-node";
import { createNatsNotifyAdapter } from "@queuert/nats";
import { acquireNats } from "@queuert/testcontainers";
import { runNotifyAdapterConformance } from "queuert/conformance";
import { test } from "vitest";

// #region conformance
test("notify-nats-transport-node adapter passes notify adapter conformance", async () => {
  await using nats = await acquireNats("nats:2");

  await runNotifyAdapterConformance(async () => {
    const nc = await connect(nats.connectionOptions);
    const notifyAdapter = createNatsNotifyAdapter({
      nc,
      subjectPrefix: `queuert.spec.${Date.now()}.${Math.random().toString(36).slice(2)}`,
    });

    return {
      notifyAdapter,
      dispose: async () => {
        await notifyAdapter.close();
        await nc.close();
      },
    };
  });
}, 60_000);
// #endregion
