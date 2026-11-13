import { conformanceTestSuite } from "@queuert/helpers/conformance";
import { detectResourceLeaks } from "@queuert/helpers/testing";
import { it as baseIt, describe } from "vitest";

import { endToEndBaseGroups, endToEndNotifyGroups } from "../conformance.end-to-end/groups.ts";
import type { StateAdapterConformanceContext } from "../conformance.state-adapter/types.ts";
import { noopNotifyAdapter, syncNoopNotifyAdapter } from "../notify-adapter/notify-adapter.noop.ts";
import {
  createInProcessStateAdapter,
  createSyncInProcessStateAdapter,
} from "../state-adapter.in-process/state-adapter.in-process.ts";

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

const syncInProcessNotifyIt = it.extend(
  "conformance",
  { scope: "file" },
  async (): Promise<StateAdapterConformanceContext> => ({
    createStateAdapter: () => createSyncInProcessStateAdapter(),
    withNonTransactionContext: (fn) => fn({ outsideTransaction: true }),
  }),
);

const syncNoopNotifyIt = it.extend(
  "conformance",
  { scope: "file" },
  async (): Promise<StateAdapterConformanceContext> => ({
    createStateAdapter: () => createSyncInProcessStateAdapter(),
    withNonTransactionContext: (fn) => fn({ outsideTransaction: true }),
    createNotifyAdapter: () => syncNoopNotifyAdapter,
  }),
);

// NOTE: hack for vitest plugin
baseIt("index");

describe("In-Process End-to-End Conformance, in-process notify", () => {
  conformanceTestSuite({
    it: inProcessNotifyIt,
    groups: [...endToEndBaseGroups, ...endToEndNotifyGroups],
    mode: "async",
  });
});

describe("In-Process End-to-End Conformance, noop notify", () => {
  conformanceTestSuite({ it: noopNotifyIt, groups: endToEndBaseGroups, mode: "async" });
});

describe("Sync In-Process End-to-End Conformance, in-process notify", () => {
  conformanceTestSuite({
    it: syncInProcessNotifyIt,
    groups: [...endToEndBaseGroups, ...endToEndNotifyGroups],
    mode: "sync",
  });
});

describe("Sync In-Process End-to-End Conformance, noop notify", () => {
  conformanceTestSuite({ it: syncNoopNotifyIt, groups: endToEndBaseGroups, mode: "sync" });
});
