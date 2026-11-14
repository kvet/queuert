import { conformanceTestSuite } from "@queuert/helpers/conformance";
import { detectResourceLeaks } from "@queuert/helpers/testing";
import { it as baseIt, describe } from "vitest";

import { endToEndBaseGroups, endToEndNotifyGroups } from "../conformance.end-to-end/groups.ts";
import type { StateAdapterConformanceContext } from "../conformance.state-adapter/types.ts";
import { createInProcessStateAdapter } from "../state-adapter.in-process/state-adapter.in-process.ts";

const it = baseIt
  .extend("resourceLeakCheck", { auto: true }, detectResourceLeaks())
  .extend("conformance", { scope: "file" }, async (): Promise<StateAdapterConformanceContext> => ({
    createStateAdapter: () => createInProcessStateAdapter(),
    withNonTransactionContext: (fn) => fn({ outsideTransaction: true }),
  }));

// NOTE: hack for vitest plugin
baseIt("index");

describe("Sync In-Process End-to-End Conformance, in-process notify", () => {
  conformanceTestSuite({ it, groups: [...endToEndBaseGroups, ...endToEndNotifyGroups] });
});
