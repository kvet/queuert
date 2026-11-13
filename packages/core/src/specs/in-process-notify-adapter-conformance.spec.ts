import { conformanceTestSuite } from "@queuert/helpers/conformance";
import { it as baseIt, describe } from "vitest";

import { notifyAdapterEndToEndGroups } from "../conformance.end-to-end/groups.ts";
import { notifyAdapterBaseGroups } from "../conformance.notify-adapter/groups.ts";
import type { NotifyAdapterConformanceContext } from "../conformance.notify-adapter/types.ts";
import {
  createInProcessNotifyAdapter,
  createSyncInProcessNotifyAdapter,
} from "../notify-adapter.in-process/notify-adapter.in-process.ts";

const it = baseIt.extend(
  "conformance",
  { scope: "file" },
  async (): Promise<NotifyAdapterConformanceContext> => ({
    createNotifyAdapter: async () => createInProcessNotifyAdapter(),
  }),
);

const syncIt = baseIt.extend(
  "conformance",
  { scope: "file" },
  async (): Promise<NotifyAdapterConformanceContext> => ({
    createNotifyAdapter: () => createSyncInProcessNotifyAdapter(),
  }),
);

it("index");

describe("In-Process Notify Adapter Conformance", () => {
  conformanceTestSuite({ it, groups: notifyAdapterBaseGroups, mode: "async" });
});

describe("Sync In-Process Notify Adapter Conformance", () => {
  conformanceTestSuite({ it: syncIt, groups: notifyAdapterBaseGroups, mode: "sync" });
});

describe("Sync In-Process Notify Adapter End-to-End Conformance", () => {
  conformanceTestSuite({ it: syncIt, groups: notifyAdapterEndToEndGroups, mode: "sync" });
});
