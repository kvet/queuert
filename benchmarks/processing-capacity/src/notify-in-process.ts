import { createInProcessNotifyAdapter, createInProcessStateAdapter } from "queuert";

import { runSyncBenchmark } from "./utils.ts";

await runSyncBenchmark({
  title: "PROCESSING CAPACITY — IN-PROCESS NOTIFY",
  stateAdapter: createInProcessStateAdapter(),
  notifyAdapter: createInProcessNotifyAdapter(),
});
