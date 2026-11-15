import {
  type NotifyAdapterConformanceContext,
  notifyAdapterConformanceCases,
  notifyAdapterEndToEndConformanceCases,
} from "queuert/conformance";
import { test } from "vitest";

import { createMemoryNotifyAdapter } from "./notify-adapter.ts";

// #region conformance
const context: NotifyAdapterConformanceContext = {
  createNotifyAdapter: async () => createMemoryNotifyAdapter(),
};

for (const conformanceCase of notifyAdapterConformanceCases) {
  test(conformanceCase.title, async () => {
    await conformanceCase.run(context);
  });
}

for (const conformanceCase of notifyAdapterEndToEndConformanceCases) {
  test(conformanceCase.title, async () => {
    await conformanceCase.run(context);
  });
}
// #endregion
