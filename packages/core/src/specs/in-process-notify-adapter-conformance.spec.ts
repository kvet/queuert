import { it as baseIt, describe } from "vitest";

import {
  type NotifyConformanceFixture,
  notifyAdapterBaseGroups,
} from "../conformance/notify-adapter-cases.ts";
import { createInProcessNotifyAdapter } from "../notify-adapter/notify-adapter.in-process.ts";
import {
  type ConformanceFixtures,
  conformanceTestSuite,
} from "../suites/conformance.test-suite.ts";

const it = baseIt.extend<ConformanceFixtures<NotifyConformanceFixture>>({
  conformance: [
    // oxlint-disable-next-line no-empty-pattern -- vitest fixtures must destructure their context
    async ({}, use) => {
      await use({ notifyAdapter: createInProcessNotifyAdapter() });
    },
    { scope: "file" },
  ],
});

it("index");

describe("In-Process Notify Adapter Conformance", () => {
  conformanceTestSuite({ it, groups: notifyAdapterBaseGroups });
});
