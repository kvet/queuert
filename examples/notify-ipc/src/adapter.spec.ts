import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createIpcNotifyAdapter } from "@queuert/ipc";
import {
  type NotifyAdapterConformanceContext,
  syncNotifyAdapterConformanceCases,
} from "queuert/conformance";
import { afterAll, beforeAll, test } from "vitest";

// #region conformance
let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "queuert-notify-ipc-spec-"));
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

const context: NotifyAdapterConformanceContext = {
  createNotifyAdapter: async () => createIpcNotifyAdapter({ directory }),
};

for (const conformanceCase of syncNotifyAdapterConformanceCases) {
  test(conformanceCase.title, async () => {
    await conformanceCase.run(context);
  });
}
// #endregion
