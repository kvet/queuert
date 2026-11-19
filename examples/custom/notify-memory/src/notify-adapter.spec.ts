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
  }),
  ...createNotifyAdapterEndToEndConformanceCases({
    createNotifyAdapter: async () => createMemoryNotifyAdapter(),
  }),
]) {
  test(conformanceCase.title, async () => {
    await conformanceCase.run();
  });
}
// #endregion
