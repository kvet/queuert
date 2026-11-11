import {
  type StateAdapterConformanceContext,
  stateAdapterConformanceCases,
  stateAdapterEndToEndConformanceCases,
} from "queuert/conformance";
import { test } from "vitest";

import { createMemoryStateAdapter } from "./state-adapter.ts";

// #region conformance
const context: StateAdapterConformanceContext = {
  createStateAdapter: async () => createMemoryStateAdapter(),
  withNonTransactionContext: async (fn) => fn({ transaction: undefined }),
};

for (const conformanceCase of stateAdapterConformanceCases) {
  test(conformanceCase.title, async () => {
    await conformanceCase.run(context);
  });
}

for (const conformanceCase of stateAdapterEndToEndConformanceCases) {
  test(conformanceCase.title, async () => {
    await conformanceCase.run(context);
  });
}
// #endregion
