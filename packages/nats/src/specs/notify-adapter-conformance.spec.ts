import { connect } from "@nats-io/transport-node";
import { extendWithNats } from "@queuert/testcontainers";
import type { NotifyAdapterConformanceContext } from "queuert/conformance";
import { notifyAdapterBaseGroups } from "queuert/conformance-internal";
import { type ConformanceFixtures, conformanceTestSuite } from "queuert/testing";
import { it as baseIt, describe } from "vitest";

import { createNatsNotifyAdapter } from "../notify-adapter/notify-adapter.nats.ts";

const it = extendWithNats(baseIt, import.meta.url);

const defaultPrefixIt = it.extend<ConformanceFixtures<NotifyAdapterConformanceContext>>({
  conformance: [
    async ({ natsConnectionOptions }, use) => {
      const nc = await connect(natsConnectionOptions);
      await use({ createNotifyAdapter: async () => createNatsNotifyAdapter({ nc }) });
      await nc.close();
    },
    { scope: "file" },
  ],
});

const customPrefixIt = it.extend<ConformanceFixtures<NotifyAdapterConformanceContext>>({
  conformance: [
    async ({ natsConnectionOptions }, use) => {
      const nc = await connect(natsConnectionOptions);
      await use({
        createNotifyAdapter: async () =>
          createNatsNotifyAdapter({
            nc,
            subjectPrefix: `myapp.notifications.${crypto.randomUUID()}`,
          }),
      });
      await nc.close();
    },
    { scope: "file" },
  ],
});

// NOTE: hack for vitest plugin
it("index");

describe("NATS Notify Adapter Conformance - Default Subject Prefix", () => {
  conformanceTestSuite({
    it: defaultPrefixIt,
    groups: notifyAdapterBaseGroups,
  });
});

describe("NATS Notify Adapter Conformance - Custom Subject Prefix", () => {
  conformanceTestSuite({
    it: customPrefixIt,
    groups: notifyAdapterBaseGroups,
  });
});
