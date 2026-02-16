import { extendWithNats } from "@queuert/testcontainers";
import { connect } from "nats";
import {
  type NotifyAdapterConformanceContext,
  notifyAdapterConformanceTestSuite,
} from "queuert/testing";
import { it as baseIt, describe } from "vitest";
import { createNatsNotifyAdapter } from "../notify-adapter/notify-adapter.nats.js";

const it = extendWithNats(baseIt, import.meta.url);

// NOTE: hack for vitest plugin
it("index");

describe("NATS Notify Adapter Conformance - Default Subject Prefix", () => {
  const conformanceIt = it.extend<NotifyAdapterConformanceContext>({
    notifyAdapter: [
      async ({ natsConnectionOptions }, use) => {
        const nc = await connect(natsConnectionOptions);

        const notifyAdapter = await createNatsNotifyAdapter({ nc });

        await use(notifyAdapter);

        await nc.close();
      },
      { scope: "test" },
    ],
  });

  notifyAdapterConformanceTestSuite({ it: conformanceIt });
});

describe("NATS Notify Adapter Conformance - Custom Subject Prefix", () => {
  const conformanceIt = it.extend<NotifyAdapterConformanceContext>({
    notifyAdapter: [
      async ({ natsConnectionOptions }, use) => {
        const nc = await connect(natsConnectionOptions);

        const notifyAdapter = await createNatsNotifyAdapter({
          nc,
          subjectPrefix: "myapp.notifications",
        });

        await use(notifyAdapter);

        await nc.close();
      },
      { scope: "test" },
    ],
  });

  notifyAdapterConformanceTestSuite({ it: conformanceIt });
});

describe("NATS Notify Adapter Conformance - With JetStream KV", () => {
  const conformanceIt = it.extend<NotifyAdapterConformanceContext>({
    notifyAdapter: [
      async ({ natsConnectionOptions }, use) => {
        const nc = await connect(natsConnectionOptions);

        const js = nc.jetstream();
        const kv = await js.views.kv(`queuert_hints_${crypto.randomUUID()}`, { ttl: 60_000 });

        const notifyAdapter = await createNatsNotifyAdapter({ nc, kv });

        await use(notifyAdapter);

        await nc.close();
      },
      { scope: "test" },
    ],
  });

  notifyAdapterConformanceTestSuite({ it: conformanceIt });
});
