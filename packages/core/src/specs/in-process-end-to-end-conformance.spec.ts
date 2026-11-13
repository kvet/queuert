import { conformanceTestSuite } from "@queuert/helpers/conformance";
import { detectResourceLeaks } from "@queuert/helpers/testing";
import { it as baseIt, describe } from "vitest";

import { endToEndBaseGroups, endToEndNotifyGroups } from "../conformance.end-to-end/groups.ts";
import type { StateAdapterConformanceContext } from "../conformance.state-adapter/types.ts";
import { noopNotifyAdapter } from "../notify-adapter/notify-adapter.noop.ts";
import { createInProcessStateAdapter } from "../state-adapter/state-adapter.in-process.ts";

const it = baseIt.extend("resourceLeakCheck", { auto: true }, detectResourceLeaks());

const inProcessNotifyIt = it.extend(
  "conformance",
  { scope: "file" },
  async (): Promise<StateAdapterConformanceContext> => ({
    createStateAdapter: async () => createInProcessStateAdapter(),
    withNonTransactionContext: async (fn) => fn({ outsideTransaction: true }),
  }),
);

const noopNotifyIt = it.extend(
  "conformance",
  { scope: "file" },
  async (): Promise<StateAdapterConformanceContext> => ({
    createStateAdapter: async () => createInProcessStateAdapter(),
    withNonTransactionContext: async (fn) => fn({ outsideTransaction: true }),
    createNotifyAdapter: async () => noopNotifyAdapter,
  }),
);

// NOTE: hack for vitest plugin
baseIt("index");

describe("In-Process End-to-End Conformance, in-process notify", () => {
  conformanceTestSuite({
    it: inProcessNotifyIt,
    groups: [...endToEndBaseGroups, ...endToEndNotifyGroups],
  });
});

describe("In-Process End-to-End Conformance, noop notify", () => {
  conformanceTestSuite({ it: noopNotifyIt, groups: endToEndBaseGroups });
});
