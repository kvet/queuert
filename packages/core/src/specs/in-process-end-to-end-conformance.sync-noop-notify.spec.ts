import { conformanceTestSuite } from "@queuert/helpers/conformance";
import { detectResourceLeaks } from "@queuert/helpers/testing";
import { it as baseIt, describe } from "vitest";

import { endToEndBaseGroups } from "../conformance.end-to-end/groups.ts";
import type { StateAdapterConformanceContext } from "../conformance.state-adapter/types.ts";
import { noopNotifyAdapter } from "../notify-adapter/notify-adapter.noop.ts";
import { createInProcessStateAdapter } from "../state-adapter.in-process/state-adapter.in-process.ts";

const it = baseIt
  .extend("resourceLeakCheck", { auto: true }, detectResourceLeaks())
  .extend("conformance", { scope: "file" }, async (): Promise<StateAdapterConformanceContext> => ({
    createStateAdapter: () => createInProcessStateAdapter(),
    withNonTransactionContext: (fn) => fn({ outsideTransaction: true }),
    createNotifyAdapter: () => noopNotifyAdapter,
  }));

const customIdsIt = baseIt
  .extend("resourceLeakCheck", { auto: true }, detectResourceLeaks())
  .extend("conformance", { scope: "file" }, async (): Promise<StateAdapterConformanceContext> => ({
    createStateAdapter: () =>
      createInProcessStateAdapter({
        generateJobId: () => `job.${crypto.randomUUID()}`,
        generateWorkerId: () => `worker.${crypto.randomUUID()}`,
      }),
    withNonTransactionContext: (fn) => fn({ outsideTransaction: true }),
    createNotifyAdapter: () => noopNotifyAdapter,
  }));

// NOTE: hack for vitest plugin
baseIt("index");

describe("Sync In-Process End-to-End Conformance, noop notify", () => {
  conformanceTestSuite({ it, groups: endToEndBaseGroups });
});

describe("Sync In-Process End-to-End Conformance, noop notify - Custom IDs", () => {
  conformanceTestSuite({ it: customIdsIt, groups: endToEndBaseGroups });
});
