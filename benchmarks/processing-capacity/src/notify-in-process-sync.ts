import { createSyncInProcessNotifyAdapter, createSyncInProcessStateAdapter } from "queuert";

import { runSyncBenchmark } from "./utils.ts";

await runSyncBenchmark({
  title: "PROCESSING CAPACITY — IN-PROCESS NOTIFY (sync)",
  stateAdapter: createSyncInProcessStateAdapter(),
  notifyAdapter: createSyncInProcessNotifyAdapter(),
});
