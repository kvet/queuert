import {
  type NotifyAdapterConformanceContext,
  notifyAdapterConformanceTestSuite,
} from "../suites/notify-adapter-conformance.test-suite.js";
import { describe, it } from "vitest";
import { createInProcessNotifyAdapter } from "../notify-adapter/notify-adapter.in-process.js";

it("index");

describe("In-Process Notify Adapter Conformance", () => {
  const conformanceIt = it.extend<NotifyAdapterConformanceContext>({
    notifyAdapter: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => {
        await use(createInProcessNotifyAdapter());
      },
      { scope: "test" },
    ],
  });

  notifyAdapterConformanceTestSuite({ it: conformanceIt });
});
