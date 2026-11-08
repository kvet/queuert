import { createInProcessStateAdapter } from "queuert/internal";

import { noopNotifyAdapter, runBenchmark } from "./utils.ts";

await runBenchmark({
  title: "PROCESSING CAPACITY — IN-PROCESS",
  stateAdapter: createInProcessStateAdapter(),
  notifyAdapter: noopNotifyAdapter,
});
