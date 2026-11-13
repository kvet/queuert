// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { connect } from "@nats-io/transport-node";
import { conformanceTestSuite } from "@queuert/helpers/conformance";
import { acquireNats } from "@queuert/testcontainers";
import type { NotifyAdapterConformanceContext } from "queuert/conformance";
import { notifyAdapterBaseGroups, notifyAdapterEndToEndGroups } from "queuert/conformance-internal";
import { it as baseIt, describe } from "vitest";

import { createNatsNotifyAdapter } from "../notify-adapter/notify-adapter.nats.ts";

const nats = await acquireNats("nats:2.2");

const it = baseIt.extend("nc", { scope: "file" }, async ({}, { onCleanup }) => {
  const nc = await connect(nats.connectionOptions);
  onCleanup(async () => {
    await nc.close();
  });
  return nc;
});

const defaultPrefixIt = it.extend(
  "conformance",
  { scope: "file" },
  async ({ nc }): Promise<NotifyAdapterConformanceContext> => ({
    createNotifyAdapter: async () => createNatsNotifyAdapter({ nc }),
  }),
);

const customPrefixIt = it.extend(
  "conformance",
  { scope: "file" },
  async ({ nc }): Promise<NotifyAdapterConformanceContext> => ({
    createNotifyAdapter: async () =>
      createNatsNotifyAdapter({ nc, subjectPrefix: `myapp.notifications.${crypto.randomUUID()}` }),
  }),
);

// NOTE: hack for vitest plugin
baseIt("index");

describe("NATS Notify Adapter Conformance - Default Subject Prefix", () => {
  conformanceTestSuite({ mode: "async", it: defaultPrefixIt, groups: notifyAdapterBaseGroups });
});

describe("NATS Notify Adapter Conformance - Custom Subject Prefix", () => {
  conformanceTestSuite({ mode: "async", it: customPrefixIt, groups: notifyAdapterBaseGroups });
});

describe("NATS Notify Adapter End-to-End Conformance", () => {
  conformanceTestSuite({ mode: "async", it: defaultPrefixIt, groups: notifyAdapterEndToEndGroups });
});
