import {
  asyncStateAdapterConformanceCases,
  asyncStateAdapterEndToEndConformanceCases,
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

for (const conformanceCase of [
  ...stateAdapterConformanceCases,
  ...asyncStateAdapterConformanceCases,
]) {
  test(conformanceCase.title, async () => {
    await conformanceCase.run(context);
  });
}

for (const conformanceCase of [
  ...stateAdapterEndToEndConformanceCases,
  ...asyncStateAdapterEndToEndConformanceCases,
]) {
  test(conformanceCase.title, async () => {
    await conformanceCase.run(context);
  });
}
// #endregion
