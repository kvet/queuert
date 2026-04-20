import { describe, it } from "vitest";

import { createInProcessNotifyAdapter } from "../notify-adapter/notify-adapter.in-process.js";
import {
  type NotifyAdapterConformanceContext,
  notifyAdapterConformanceTestSuite,
} from "../suites/notify-adapter-conformance.test-suite.js";

it("index");

describe("In-Process Notify Adapter Conformance", () => {
  const conformanceIt = it.extend<NotifyAdapterConformanceContext>({
    notifyAdapter: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => {
        await use(await createInProcessNotifyAdapter());
      },
      { scope: "test" },
    ],
  });

  notifyAdapterConformanceTestSuite({ it: conformanceIt });
});
