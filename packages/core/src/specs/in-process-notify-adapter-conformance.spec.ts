import { conformanceTestSuite } from "@queuert/helpers/conformance";
import { it as baseIt, describe } from "vitest";

import { notifyAdapterBaseGroups } from "../conformance.notify-adapter/groups.ts";
import type { NotifyAdapterConformanceContext } from "../conformance.notify-adapter/types.ts";
import { createInProcessNotifyAdapter } from "../notify-adapter/notify-adapter.in-process.ts";

const it = baseIt.extend(
  "conformance",
  { scope: "file" },
  async (): Promise<NotifyAdapterConformanceContext> => ({
    createNotifyAdapter: async () => createInProcessNotifyAdapter(),
  }),
);

it("index");

describe("In-Process Notify Adapter Conformance", () => {
  conformanceTestSuite({ it, groups: notifyAdapterBaseGroups });
});
