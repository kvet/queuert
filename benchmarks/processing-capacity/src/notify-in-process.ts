import { createInProcessNotifyAdapter, createInProcessStateAdapter } from "queuert/internal";

import { runBenchmark } from "./utils.ts";

await runBenchmark({
  title: "PROCESSING CAPACITY — IN-PROCESS NOTIFY",
  stateAdapter: createInProcessStateAdapter(),
  notifyAdapter: createInProcessNotifyAdapter(),
});
