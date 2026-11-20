import {
  createNotifyAdapterConformanceCases,
  createNotifyAdapterEndToEndConformanceCases,
} from "queuert/conformance";
import { test } from "vitest";

import { createMemoryNotifyAdapter } from "./notify-adapter.ts";

// #region conformance
for (const conformanceCase of [
  ...createNotifyAdapterConformanceCases({
    createNotifyAdapter: async () => createMemoryNotifyAdapter(),
    mode: "async",
  }),
  ...createNotifyAdapterEndToEndConformanceCases({
    createNotifyAdapter: async () => createMemoryNotifyAdapter(),
    mode: "async",
  }),
]) {
  test(conformanceCase.title, async () => {
    await conformanceCase.run();
  });
}
// #endregion
