import { createInProcessNotifyAdapter, createInProcessStateAdapter } from "queuert";

import { runBenchmark } from "./utils.js";

await runBenchmark({
  title: "PROCESSING CAPACITY — IN-PROCESS NOTIFY",
  stateAdapter: await createInProcessStateAdapter(),
  notifyAdapter: await createInProcessNotifyAdapter(),
});
