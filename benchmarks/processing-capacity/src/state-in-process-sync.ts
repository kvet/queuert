import { createSyncInProcessStateAdapter } from "queuert";

import { noopSyncNotifyAdapter, runSyncBenchmark } from "./utils.ts";

await runSyncBenchmark({
  title: "PROCESSING CAPACITY — IN-PROCESS (sync)",
  stateAdapter: createSyncInProcessStateAdapter(),
  notifyAdapter: noopSyncNotifyAdapter,
});
