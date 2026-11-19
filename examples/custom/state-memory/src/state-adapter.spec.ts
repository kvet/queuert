import {
  createStateAdapterConformanceCases,
  createStateAdapterEndToEndConformanceCases,
} from "queuert/conformance";
import { test } from "vitest";

import { createMemoryStateAdapter } from "./state-adapter.ts";

// #region conformance
for (const conformanceCase of [
  ...createStateAdapterConformanceCases({
    mode: "async",
    createStateAdapter: async () => createMemoryStateAdapter(),
    withNonTransactionContext: async (fn) => fn({ transaction: undefined }),
  }),
  ...createStateAdapterEndToEndConformanceCases({
    mode: "async",
    createStateAdapter: async () => createMemoryStateAdapter(),
    withNonTransactionContext: async (fn) => fn({ transaction: undefined }),
  }),
]) {
  test(conformanceCase.title, async () => {
    await conformanceCase.run();
  });
}
// #endregion
